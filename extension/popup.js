const apiKeyInput = document.getElementById('apiKey');
const modelSelect = document.getElementById('model');
const statusEl = document.getElementById('status');
const solveBtn = document.getElementById('solve-btn');
const resultEl = document.getElementById('result');
const gradedOnlyInput = document.getElementById('gradedOnly');

chrome.storage.sync.get({ gradedOnlyEnabled: true }, ({ gradedOnlyEnabled }) => {
  gradedOnlyInput.checked = gradedOnlyEnabled !== false;
});

chrome.storage.sync.get(['geminiApiKey', 'geminiModel'], ({ geminiApiKey, geminiModel }) => {
  if (geminiApiKey) apiKeyInput.value = geminiApiKey;
  if (geminiModel) modelSelect.value = geminiModel;
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
  const geminiApiKey = apiKeyInput.value.trim();
  const geminiModel = modelSelect.value;
  chrome.storage.sync.set({ geminiApiKey, geminiModel }, () => {
    statusEl.textContent = 'Saved.';
    setTimeout(() => { statusEl.textContent = ''; }, 1500);
  });
});

// Runs inside the active page (no access to variables from this file). Finds the block of
// content between the "Graded Assignment" heading and the Honor Code section, groups the
// radio/checkbox inputs into questions, tags each option with a stable id, and returns that
// structure (question text + option text + option id) so it can be sent to Gemini.
function extractQuestionsFromPage() {
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

  const startEl = findStartElement();
  if (!startEl) {
    return { ok: false, error: 'Could not find a "Graded Assignment" heading on this page.' };
  }
  const endEl = findEndElement();

  const inputs = Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]')).filter((input) =>
    isInRange(input, startEl, endEl)
  );

  if (!inputs.length) {
    return { ok: false, error: 'No radio/checkbox questions were found between the heading and the Honor Code section.' };
  }

  const groups = new Map(); // groupKey -> { container, inputs: [] }
  inputs.forEach((input, idx) => {
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

  return { ok: true, questions };
}

// Runs inside the active page. Clicks the inputs matching the option ids Gemini chose.
function applyAnswersToPage(answers) {
  let applied = 0;
  let missing = 0;
  (answers || []).forEach((ans) => {
    (ans.optionIds || []).forEach((oid) => {
      const input = document.querySelector(`[data-ai-oid="${CSS.escape(oid)}"]`);
      if (!input) {
        missing += 1;
        return;
      }
      if (!input.checked) input.click();
      applied += 1;
    });
  });
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

    showResult('Asking Gemini...', false);

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
        const [{ result: applyStats }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: applyAnswersToPage,
          args: [response.answers]
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
