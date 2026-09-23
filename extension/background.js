const DEFAULT_MODEL = 'gemini-3.8-flash';
const DEFAULT_OPENROUTER_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';

const ANSWER_SCHEMA = {
  type: 'OBJECT',
  properties: {
    answers: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          questionId: { type: 'STRING' },
          optionIds: { type: 'ARRAY', items: { type: 'STRING' } },
          value: { type: 'STRING' },
          explanation: { type: 'STRING' }
        },
        required: ['questionId']
      }
    }
  },
  required: ['answers']
};

function buildPrompt(questions) {
  return [
    'You are helping a student answer a graded assignment made of multiple-choice/checkbox questions and free-text/number input questions.',
    'Below is a JSON array of questions extracted from the page. Each question has an id, a type',
    '("radio" = exactly one correct option, "checkbox" = one or more correct options, "dropdown" = a select box with exactly one correct option, "text" = free-text or numeric answer typed into an input box), its text, and (for radio/checkbox/dropdown) a list of options (each with an id and text).',
    'For "radio"/"checkbox"/"dropdown" questions, return the correct option id(s) in "optionIds" so the extension can click/select the matching choice on the page. Only use option ids that appear in the input. For "radio" and "dropdown" questions return exactly one optionId.',
    'For "text" questions, return the answer as a string in the "value" field (do not include "optionIds"). Keep numeric answers as plain numbers/text with no extra words unless the question asks for an explanation.',
    'Respond with ONLY a JSON object matching this shape: {"answers":[{"questionId":"...","optionIds":["..."],"value":"...","explanation":"..."}]}. Do not include markdown fences or extra commentary.',
    '',
    '---QUESTIONS JSON START---',
    JSON.stringify(questions),
    '---QUESTIONS JSON END---'
  ].join('\n');
}

async function solveWithGemini(questions, apiKey, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || DEFAULT_MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(questions) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: ANSWER_SCHEMA
      }
    })
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message = data?.error?.message || `Gemini request failed (${res.status})`;
    throw new Error(message);
  }

  const raw = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim();
  if (!raw) {
    throw new Error('Gemini returned no answer.');
  }
  return raw;
}

async function solveWithOpenRouter(questions, apiKey, model) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/quizlens-ai',
      'X-Title': 'QuizLens AI'
    },
    body: JSON.stringify({
      model: model || DEFAULT_OPENROUTER_MODEL,
      messages: [{ role: 'user', content: buildPrompt(questions) }],
      response_format: { type: 'json_object' },
      max_tokens: 4096,
      // Reasoning models otherwise burn the whole token budget on hidden thinking and return empty content.
      reasoning: { enabled: false, exclude: true }
    })
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message = data?.error?.message || `OpenRouter request failed (${res.status})`;
    throw new Error(message);
  }

  const choice = data?.choices?.[0];
  const raw = (choice?.message?.content || choice?.message?.reasoning_content || choice?.text || '').trim();
  if (!raw) {
    const finishReason = choice?.finish_reason || choice?.native_finish_reason;
    const hint = finishReason === 'length'
      ? ' The model hit its token limit before producing an answer (try again or pick a different model).'
      : '';
    throw new Error(`OpenRouter returned no answer.${hint} Raw response: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return raw;
}

async function solveQuestions(questions) {
  const { aiProvider, geminiApiKey, geminiModel, openrouterApiKey, openrouterModel } = await chrome.storage.sync.get([
    'aiProvider',
    'geminiApiKey',
    'geminiModel',
    'openrouterApiKey',
    'openrouterModel'
  ]);

  const provider = aiProvider || 'gemini';

  let raw;
  if (provider === 'openrouter') {
    if (!openrouterApiKey) {
      throw new Error('Missing OpenRouter API key. Set it via the extension popup first.');
    }
    raw = await solveWithOpenRouter(questions, openrouterApiKey, openrouterModel);
  } else {
    if (!geminiApiKey) {
      throw new Error('Missing Gemini API key. Set it via the extension popup first.');
    }
    raw = await solveWithGemini(questions, geminiApiKey, geminiModel);
  }

  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`${provider === 'openrouter' ? 'OpenRouter' : 'Gemini'} returned a response that was not valid JSON.`);
  }

  if (!Array.isArray(parsed?.answers)) {
    throw new Error('AI response did not include an "answers" array.');
  }
  return parsed.answers;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'SOLVE_ASSIGNMENT') return undefined;

  solveQuestions(message.questions)
    .then((answers) => sendResponse({ ok: true, answers }))
    .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));

  return true; // keep the message channel open for the async response
});

