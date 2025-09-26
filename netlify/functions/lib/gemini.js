const GEMINI_ENV_KEYS = [
  'GEMINI_API_KEY',
  'GOOGLE_GENAI_API_KEY',
  'GOOGLE_AI_API_KEY',
  'AI_STUDIO_API_KEY',
  'REACT_APP_GEMINI_API_KEY',
];

const readEnvValue = (key) => {
  const raw = process.env?.[key];
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  return trimmed || '';
};

export const getGeminiKeyDetail = () => {
  for (const key of GEMINI_ENV_KEYS) {
    const value = readEnvValue(key);
    if (value) return { key, token: value };
  }
  for (const key of GEMINI_ENV_KEYS) {
    const value = readEnvValue(key.toLowerCase());
    if (value) return { key: key.toLowerCase(), token: value };
  }
  return { key: '', token: '' };
};

export const getGeminiApiKey = () => getGeminiKeyDetail().token;

export const getGeminiModel = () => {
  const model = readEnvValue('GEMINI_MODEL');
  return model || 'gemini-1.5-flash';
};

export async function generateGeminiContent({ apiKey, model, systemPrompt, userPrompt }) {
  if (!apiKey) {
    throw new Error('Gemini API key missing.');
  }
  const chosenModel = model || getGeminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(chosenModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: userPrompt },
        ],
      },
    ],
  };
  if (systemPrompt) {
    body.systemInstruction = {
      role: 'system',
      parts: [
        { text: systemPrompt },
      ],
    };
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const message = errorText.slice(0, 500) || response.statusText || 'Unknown Gemini API error';
    const err = new Error(`Gemini API error ${response.status}: ${message}`);
    err.status = response.status;
    throw err;
  }

  const payload = await response.json();
  const text = payload?.candidates?.flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n') || '';

  return {
    model: chosenModel,
    text,
    payload,
  };
}

export default {
  GEMINI_ENV_KEYS,
  getGeminiApiKey,
  getGeminiKeyDetail,
  getGeminiModel,
  generateGeminiContent,
};
