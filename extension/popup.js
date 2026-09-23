const apiKeyInput = document.getElementById('apiKey');
const apiKeyLabel = document.getElementById('apiKeyLabel');
const providerSelect = document.getElementById('provider');
const modelSelect = document.getElementById('model');
const openrouterModelSelect = document.getElementById('openrouterModel');
const geminiModelGroup = document.getElementById('geminiModelGroup');
const openrouterModelGroup = document.getElementById('openrouterModelGroup');
const statusEl = document.getElementById('status');
const solveBtn = document.getElementById('solve-btn');
const resultEl = document.getElementById('result');
const gradedOnlyInput = document.getElementById('gradedOnly');

function updateProviderUi(provider) {
  const isOpenRouter = provider === 'openrouter';
  geminiModelGroup.style.display = isOpenRouter ? 'none' : '';
  openrouterModelGroup.style.display = isOpenRouter ? '' : 'none';
  apiKeyLabel.textContent = isOpenRouter ? 'OpenRouter API Key' : 'Gemini API Key';
  apiKeyInput.placeholder = isOpenRouter ? 'Enter your OpenRouter API key' : 'Enter your Gemini API key';
}

chrome.storage.sync.get({ gradedOnlyEnabled: true }, ({ gradedOnlyEnabled }) => {
  gradedOnlyInput.checked = gradedOnlyEnabled !== false;
});

// Mode Tabs switching
const tabApiBtn = document.getElementById('tab-api-btn');
const tabManualBtn = document.getElementById('tab-manual-btn');
const paneApi = document.getElementById('pane-api');
const paneManual = document.getElementById('pane-manual');

function setActiveTab(mode) {
  const isApi = mode !== 'manual';
  tabApiBtn.classList.toggle('active', isApi);
  tabApiBtn.setAttribute('aria-selected', String(isApi));
  paneApi.classList.toggle('active', isApi);

  tabManualBtn.classList.toggle('active', !isApi);
  tabManualBtn.setAttribute('aria-selected', String(!isApi));
  paneManual.classList.toggle('active', !isApi);

  chrome.storage.sync.set({ preferredSolverMode: isApi ? 'api' : 'manual' });
}

tabApiBtn?.addEventListener('click', () => setActiveTab('api'));
tabManualBtn?.addEventListener('click', () => setActiveTab('manual'));

chrome.storage.sync.get({ preferredSolverMode: 'api' }, ({ preferredSolverMode }) => {
  setActiveTab(preferredSolverMode);
});

chrome.storage.sync.get(
  ['aiProvider', 'geminiApiKey', 'geminiModel', 'openrouterApiKey', 'openrouterModel'],
  ({ aiProvider, geminiApiKey, geminiModel, openrouterApiKey, openrouterModel }) => {
    const provider = aiProvider || 'gemini';
    providerSelect.value = provider;
    if (geminiModel) modelSelect.value = geminiModel;
    if (openrouterModel) openrouterModelSelect.value = openrouterModel;
    apiKeyInput.value = (provider === 'openrouter' ? openrouterApiKey : geminiApiKey) || '';
    updateProviderUi(provider);
  }
);

providerSelect.addEventListener('change', async () => {
  const provider = providerSelect.value;
  updateProviderUi(provider);
  const { geminiApiKey, openrouterApiKey } = await chrome.storage.sync.get(['geminiApiKey', 'openrouterApiKey']);
  apiKeyInput.value = (provider === 'openrouter' ? openrouterApiKey : geminiApiKey) || '';
});

gradedOnlyInput.addEventListener('change', async () => {
  const gradedOnlyEnabled = gradedOnlyInput.checked;
  chrome.storage.sync.set({ gradedOnlyEnabled });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  chrome.tabs.sendMessage(tab.id, { type: 'SET_GRADED_ONLY_FILTER', enabled: gradedOnlyEnabled }, () => {
    void chrome.runtime.lastError;
  });
});

document.getElementById('save').addEventListener('click', () => {
  const aiProvider = providerSelect.value;
  const apiKey = apiKeyInput.value.trim();
  const update = { aiProvider, geminiModel: modelSelect.value, openrouterModel: openrouterModelSelect.value };
  if (aiProvider === 'openrouter') {
    update.openrouterApiKey = apiKey;
  } else {
    update.geminiApiKey = apiKey;
  }
  chrome.storage.sync.set(update, () => {
    statusEl.textContent = 'Saved.';
    setTimeout(() => { statusEl.textContent = ''; }, 1500);
  });
});

// Runs inside the active page (no access to variables from this file). Finds the block of
// content between the "Graded Assignment" heading and the Honor Code section, groups the
// radio/checkbox inputs into questions, tags each option with a stable id, and returns that
// structure (question text + option text + option id) so it can be sent to Gemini.
async function extractQuestionsFromPage() {
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function findElementByText(selector, text) {
    const needle = text.toLowerCase();
    const candidates = document.querySelectorAll(selector);
    for (const el of candidates) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join('')
        .trim()
        .toLowerCase();
      if (own.includes(needle)) return el;
    }
    return null;
  }

  function findStartElement() {
    return (
      document.querySelector('[data-testid="header-left"]') ||
      findElementByText('h1,h2,p,span,div', 'Graded Assignment') ||
      document.querySelector('h1')
    );
  }

  function findEndElement() {
    return (
      document.querySelector('[data-testid="HonorCodeAgreement"]') ||
      document.querySelector('[data-testid="AttemptSubmitControls"]') ||
      findElementByText('h1,h2,h3,p,strong,b', 'Honor Code')
    );
  }

  function isInRange(node, startEl, endEl) {
    const afterStart = !!(startEl.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
    const beforeEnd = !endEl || !!(node.compareDocumentPosition(endEl) & Node.DOCUMENT_POSITION_FOLLOWING);
    return afterStart && beforeEnd;
  }

  function optionText(input) {
    const labelledBy = input.getAttribute('aria-labelledby');
    if (labelledBy) {
      const el = document.getElementById(labelledBy);
      if (el?.innerText?.trim()) return el.innerText.trim();
    }
    const label = input.closest('label');
    if (label?.innerText?.trim()) return label.innerText.trim();
    if (input.id) {
      const forLabel = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (forLabel?.innerText?.trim()) return forLabel.innerText.trim();
    }
    return (input.value || '').trim();
  }

  function questionText(container, fallbackIndex) {
    const prompt = container?.querySelector('[id^="prompt-"]') || container?.querySelector('[data-testid="legend"]');
    if (prompt?.innerText?.trim()) return prompt.innerText.trim();
    const labelledBy = container?.getAttribute('aria-labelledby');
    if (labelledBy) {
      const el = document.getElementById(labelledBy);
      if (el?.innerText?.trim()) return el.innerText.trim();
    }
    return `Question ${fallbackIndex}`;
  }

 
  function findOpenListbox() {
    const listboxes = Array.from(document.querySelectorAll('[role="listbox"]')).filter((el) => el.offsetParent !== null);
    return listboxes[listboxes.length - 1] || null;
  }

  // react-aria/CDS widgets use usePress (pointer events), not plain click, to open/select.
  function firePress(el) {
    el.focus?.();
    const opts = { bubbles: true, cancelable: true, view: window, pointerId: 1, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  function fireEscape() {
    const opts = { bubbles: true, cancelable: true, key: 'Escape', code: 'Escape' };
    document.dispatchEvent(new KeyboardEvent('keydown', opts));
    document.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  async function readDropdownOptions(trigger) {
    firePress(trigger);
    let listbox = null;
    for (let i = 0; i < 20 && !listbox; i += 1) {
      await sleep(50);
      listbox = findOpenListbox();
    }
    const texts = listbox
      ? Array.from(listbox.querySelectorAll('[role="option"]')).map((opt) => (opt.innerText || opt.textContent || '').trim())
      : [];
    fireEscape();
    await sleep(50);
    return texts;
  }

  const startEl = findStartElement();
  if (!startEl) {
    return { ok: false, error: 'Could not find a "Graded Assignment" heading on this page.' };
  }
  const endEl = findEndElement();

  const choiceInputs = Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]')).filter((input) =>
    isInRange(input, startEl, endEl)
  );

  const textInputs = Array.from(
    document.querySelectorAll('input[type="text"], input[type="number"], input:not([type]), textarea')
  ).filter((input) => isInRange(input, startEl, endEl) && input.getAttribute('aria-hidden') !== 'true' && input.tabIndex !== -1);

  const selectDropdowns = Array.from(document.querySelectorAll('select')).filter((select) => isInRange(select, startEl, endEl));

  const customDropdowns = Array.from(
    document.querySelectorAll('[role="button"][aria-haspopup="listbox"], [role="combobox"][aria-haspopup="listbox"]')
  ).filter((trigger) => isInRange(trigger, startEl, endEl));

  if (!choiceInputs.length && !textInputs.length && !selectDropdowns.length && !customDropdowns.length) {
    return { ok: false, error: 'No radio/checkbox/text/dropdown questions were found between the heading and the Honor Code section.' };
  }

  const groups = new Map(); // groupKey -> { container, inputs: [] }
  choiceInputs.forEach((input, idx) => {
    const container = input.closest('[role="radiogroup"]') || input.closest('[role="group"]') || input.closest('fieldset');
    const key = container || (input.type === 'radio' && input.name ? `name:${input.name}` : `solo:${idx}`);
    if (!groups.has(key)) groups.set(key, { container: container || null, inputs: [] });
    groups.get(key).inputs.push(input);
  });

  const questions = [];
  let qIndex = 0;
  for (const { container, inputs: groupInputs } of groups.values()) {
    qIndex += 1;
    const qid = `q${qIndex}`;
    const type = groupInputs.every((i) => i.type === 'checkbox') ? 'checkbox' : 'radio';
    const options = groupInputs.map((input, oIdx) => {
      const oid = `${qid}-o${oIdx + 1}`;
      input.setAttribute('data-ai-oid', oid);
      return { id: oid, text: optionText(input) };
    });
    questions.push({ id: qid, type, text: questionText(container, qIndex), options });
  }

  textInputs.forEach((input) => {
    qIndex += 1;
    const qid = `q${qIndex}`;
    input.setAttribute('data-ai-oid', qid);
    const container = input.closest('[role="group"]') || input.closest('fieldset') || input.parentElement;
    questions.push({ id: qid, type: 'text', text: questionText(container, qIndex), options: [] });
  });

  selectDropdowns.forEach((select) => {
    qIndex += 1;
    const qid = `q${qIndex}`;
    select.setAttribute('data-ai-oid', qid);
    const options = Array.from(select.options)
      .filter((opt) => opt.value !== '')
      .map((opt, oIdx) => {
        const oid = `${qid}-o${oIdx + 1}`;
        opt.setAttribute('data-ai-oid', oid);
        return { id: oid, text: (opt.innerText || opt.textContent || '').trim() };
      });
    const container = select.closest('[role="group"]') || select.closest('fieldset') || select.parentElement;
    questions.push({ id: qid, type: 'dropdown', text: questionText(container, qIndex), options });
  });

  for (const trigger of customDropdowns) {
    qIndex += 1;
    const qid = `q${qIndex}`;
    trigger.setAttribute('data-ai-oid', qid);
    const optionTexts = await readDropdownOptions(trigger);
    const options = optionTexts.map((text, oIdx) => ({ id: `${qid}-o${oIdx + 1}`, text }));
    const container = trigger.closest('[role="group"]') || trigger.closest('fieldset') || trigger.parentElement;
    questions.push({ id: qid, type: 'dropdown', text: questionText(container, qIndex), options });
  }

  return { ok: true, questions };
}

// Runs inside the active page. Applies the option ids / values the AI chose to the matching inputs.
async function applyAnswersToPage(answers) {
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function findOpenListbox() {
    const listboxes = Array.from(document.querySelectorAll('[role="listbox"]')).filter((el) => el.offsetParent !== null);
    return listboxes[listboxes.length - 1] || null;
  }

  // react-aria/CDS widgets use usePress (pointer events), not plain click, to open/select.
  function firePress(el) {
    el.focus?.();
    const opts = { bubbles: true, cancelable: true, view: window, pointerId: 1, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  function fireEscape() {
    const opts = { bubbles: true, cancelable: true, key: 'Escape', code: 'Escape' };
    document.dispatchEvent(new KeyboardEvent('keydown', opts));
    document.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  function normalize(text) {
    return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  async function chooseCustomDropdownOption(trigger, optionIndex, optionText) {
    firePress(trigger);
    let listbox = null;
    for (let i = 0; i < 20 && !listbox; i += 1) {
      await sleep(50);
      listbox = findOpenListbox();
    }
    if (!listbox) return false;
    const optionEls = Array.from(listbox.querySelectorAll('[role="option"]'));
    const wanted = normalize(optionText);
    let option = wanted ? optionEls.find((el) => normalize(el.innerText || el.textContent) === wanted) : null;
    if (!option && wanted) {
      option = optionEls.find((el) => normalize(el.innerText || el.textContent).includes(wanted) || wanted.includes(normalize(el.innerText || el.textContent)));
    }
    if (!option) option = optionEls[optionIndex];
    if (!option) {
      fireEscape();
      return false;
    }
    firePress(option);
    await sleep(100);
    if (findOpenListbox()) fireEscape();
    return true;
  }

  let applied = 0;
  let missing = 0;
  for (const ans of answers || []) {
    if (ans.optionIds && ans.optionIds.length) {
      for (const oid of ans.optionIds) {
        const option = document.querySelector(`option[data-ai-oid="${CSS.escape(oid)}"]`);
        if (option) {
          const select = option.closest('select');
          select.value = option.value;
          select.dispatchEvent(new Event('input', { bubbles: true }));
          select.dispatchEvent(new Event('change', { bubbles: true }));
          applied += 1;
          continue;
        }

        const match = /^(.*)-o(\d+)$/.exec(oid);
        const trigger = match && document.querySelector(`[role="button"][data-ai-oid="${CSS.escape(match[1])}"], [role="combobox"][data-ai-oid="${CSS.escape(match[1])}"]`);
        if (trigger) {
          const optionIdx = ans.optionIds.indexOf(oid);
          const optionText = ans.optionTexts?.[optionIdx];
          const ok = await chooseCustomDropdownOption(trigger, Number(match[2]) - 1, optionText);
          if (ok) applied += 1; else missing += 1;
          continue;
        }

        const input = document.querySelector(`[data-ai-oid="${CSS.escape(oid)}"]`);
        if (!input) {
          missing += 1;
          continue;
        }
        if (!input.checked) input.click();
        applied += 1;
      }
      continue;
    }
    if (typeof ans.value === 'string') {
      const input = document.querySelector(`[data-ai-oid="${CSS.escape(ans.questionId)}"]`);
      if (!input) {
        missing += 1;
        continue;
      }
      const setter = Object.getOwnPropertyDescriptor(input.__proto__, 'value')?.set;
      if (setter) setter.call(input, ans.value); else input.value = ans.value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      applied += 1;
    }
  }
  return { applied, missing };
}

function showResult(text, isError) {
  resultEl.style.display = 'block';
  resultEl.classList.toggle('error', !!isError);
  resultEl.textContent = text;
}

function renderAnswers(questions, answers, applyStats) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const lines = answers.map((ans) => {
    const q = byId.get(ans.questionId);
    if (q?.type === 'text' || typeof ans.value === 'string') {
      return `${q ? q.text : ans.questionId}\n  -> ${ans.value ?? '(no value provided)'}`;
    }
    const optionTexts = (ans.optionIds || [])
      .map((oid) => q?.options.find((o) => o.id === oid)?.text || oid)
      .join(', ');
    return `${q ? q.text : ans.questionId}\n  -> ${optionTexts || '(no option chosen)'}`;
  });
  lines.push('', `Applied ${applyStats.applied} answer(s) on the page${applyStats.missing ? `, ${applyStats.missing} could not be matched.` : '.'}`);
  showResult(lines.join('\n\n'), false);
}

solveBtn.addEventListener('click', async () => {
  solveBtn.disabled = true;
  showResult('Reading assignment from the page...', false);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found.');

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractQuestionsFromPage
    });

    if (!result?.ok) {
      throw new Error(result?.error || 'Could not read the assignment content.');
    }

    const { aiProvider, geminiModel, openrouterModel } = await chrome.storage.sync.get(['aiProvider', 'geminiModel', 'openrouterModel']);
    const activeModel = aiProvider === 'openrouter' ? (openrouterModel || openrouterModelSelect.value) : (geminiModel || modelSelect.value);
    showResult(`Asking ${activeModel}...`, false);

    chrome.runtime.sendMessage({ type: 'SOLVE_ASSIGNMENT', questions: result.questions }, async (response) => {
      if (!response) {
        solveBtn.disabled = false;
        showResult('No response from the extension background script.', true);
        return;
      }
      if (!response.ok) {
        solveBtn.disabled = false;
        showResult(response.error || 'Something went wrong.', true);
        return;
      }

      try {
        const enrichedAnswers = enrichAnswersWithOptionTexts(result.questions, response.answers);

        const [{ result: applyStats }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: applyAnswersToPage,
          args: [enrichedAnswers]
        });
        renderAnswers(result.questions, response.answers, applyStats);
      } catch (err) {
        showResult(err.message || String(err), true);
      } finally {
        solveBtn.disabled = false;
      }
    });
  } catch (err) {
    solveBtn.disabled = false;
    showResult(err.message || String(err), true);
  }
});

// Attaches the option text each optionId refers to, so the page-side apply logic can match
// dropdown/select options by text instead of relying solely on positional index.
function enrichAnswersWithOptionTexts(questions, answers) {
  const questionById = new Map(questions.map((q) => [q.id, q]));
  return (answers || []).map((ans) => {
    const q = questionById.get(ans.questionId);
    const optionTexts = (ans.optionIds || []).map((oid) => q?.options.find((o) => o.id === oid)?.text || null);
    return { ...ans, optionTexts };
  });
}

function buildCopyPrompt(questions) {
  return [
    'You are helping a student answer a graded assignment made of multiple-choice/checkbox/dropdown questions and free-text/number input questions.',
    'Below is a JSON array of questions extracted from the page. Each question has an id, a type',
    '("radio" = exactly one correct option, "checkbox" = one or more correct options, "dropdown" = a select box with exactly one correct option, "text" = free-text or numeric answer typed into an input box), its text, and (for radio/checkbox/dropdown) a list of options (each with an id and text).',
    'For "radio"/"checkbox"/"dropdown" questions, answer with the correct option id(s) in "optionIds". For "radio" and "dropdown" questions return exactly one optionId. For "checkbox" return every correct optionId.',
    'For "text" questions, answer with a string in the "value" field (omit "optionIds"). Keep numeric answers as plain numbers/text with no extra words.',
    'Respond with ONLY a single JSON object in exactly this shape, no markdown code fences, no extra commentary before or after it:',
    '{"answers":[{"questionId":"q1","optionIds":["q1-o2"],"value":"","explanation":"short reason"}]}',
    '',
    '---QUESTIONS JSON START---',
    JSON.stringify(questions),
    '---QUESTIONS JSON END---'
  ].join('\n');
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall through to the legacy fallback below.
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

// Finds the first balanced {...} or [...] block in the text, respecting quoted strings,
// so we can tolerate stray prose or markdown fences around the AI's JSON reply.
function extractJsonBlock(text) {
  const opens = { '{': '}', '[': ']' };
  let start = -1;
  let openChar = null;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{' || text[i] === '[') {
      start = i;
      openChar = text[i];
      break;
    }
  }
  if (start === -1) return null;
  const closeChar = opens[openChar];
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === openChar) depth += 1;
    else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseAnswersFromPastedText(raw) {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const jsonBlock = extractJsonBlock(cleaned) || cleaned;

  let parsed;
  try {
    parsed = JSON.parse(jsonBlock);
  } catch {
    throw new Error("Could not parse the pasted text as JSON. Make sure you pasted the AI's full JSON reply.");
  }

  const answers = Array.isArray(parsed) ? parsed : parsed?.answers;
  if (!Array.isArray(answers)) {
    throw new Error('Pasted JSON did not contain an "answers" array.');
  }
  return answers;
}

const copyQuestionsBtn = document.getElementById('copy-questions-btn');
const applyPastedBtn = document.getElementById('apply-pasted-btn');
const pastedAnswerInput = document.getElementById('pastedAnswer');

copyQuestionsBtn.addEventListener('click', async () => {
  copyQuestionsBtn.disabled = true;
  showResult('Reading assignment from the page...', false);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found.');

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractQuestionsFromPage
    });

    if (!result?.ok) {
      throw new Error(result?.error || 'Could not read the assignment content.');
    }

    await copyToClipboard(buildCopyPrompt(result.questions));
    const originalBtnHtml = copyQuestionsBtn.innerHTML;
    copyQuestionsBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      Copied to Clipboard!
    `;
    setTimeout(() => {
      copyQuestionsBtn.innerHTML = originalBtnHtml;
    }, 2000);

    showResult(
      `✓ Copied ${result.questions.length} question(s) to clipboard.\n\nNext: Paste into ChatGPT/Claude/Gemini, copy its JSON reply, and paste below.`,
      false
    );
  } catch (err) {
    showResult(err.message || String(err), true);
  } finally {
    copyQuestionsBtn.disabled = false;
  }
});

applyPastedBtn.addEventListener('click', async () => {
  const raw = pastedAnswerInput.value.trim();
  if (!raw) {
    showResult("Paste the AI's answer JSON first.", true);
    return;
  }

  applyPastedBtn.disabled = true;
  showResult('Applying pasted answer...', false);

  try {
    const parsedAnswers = parseAnswersFromPastedText(raw);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found.');

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractQuestionsFromPage
    });

    if (!result?.ok) {
      throw new Error(result?.error || 'Could not read the assignment content.');
    }

    const enrichedAnswers = enrichAnswersWithOptionTexts(result.questions, parsedAnswers);

    const [{ result: applyStats }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: applyAnswersToPage,
      args: [enrichedAnswers]
    });
    renderAnswers(result.questions, parsedAnswers, applyStats);
  } catch (err) {
    showResult(err.message || String(err), true);
  } finally {
    applyPastedBtn.disabled = false;
  }
});
