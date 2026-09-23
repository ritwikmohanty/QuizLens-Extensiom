const DEFAULT_MODEL = 'gemini-3.8-flash';

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
          explanation: { type: 'STRING' }
        },
        required: ['questionId', 'optionIds']
      }
    }
  },
  required: ['answers']
};

async function solveQuestions(questions) {
  const { geminiApiKey, geminiModel } = await chrome.storage.sync.get(['geminiApiKey', 'geminiModel']);
  if (!geminiApiKey) {
    throw new Error('Missing Gemini API key. Set it via the extension popup first.');
  }

  const model = geminiModel || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;

  const prompt = [
    'You are helping a student answer a graded assignment made of multiple-choice/checkbox questions.',
    'Below is a JSON array of questions extracted from the page. Each question has an id, a type',
    '("radio" = exactly one correct option, "checkbox" = one or more correct options), its text, and a list of options (each with an id and text).',
    'Return the correct option id(s) for every question so the extension can click the matching radio/checkbox on the page.',
    'Only use option ids that appear in the input. For "radio" questions return exactly one optionId.',
    '',
    '---QUESTIONS JSON START---',
    JSON.stringify(questions),
    '---QUESTIONS JSON END---'
  ].join('\n');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
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

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Gemini returned a response that was not valid JSON.');
  }

  if (!Array.isArray(parsed?.answers)) {
    throw new Error('Gemini response did not include an "answers" array.');
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

