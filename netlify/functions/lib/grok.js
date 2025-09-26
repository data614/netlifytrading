const GROK_ENV_KEYS = [
  'GROK_API_KEY',
  'XAI_API_KEY',
  'XAI_GROK_API_KEY',
  'REACT_APP_GROK_API_KEY',
];

const readEnvValue = (key) => {
  const raw = process.env?.[key];
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  return trimmed || '';
};

export const getGrokKeyDetail = () => {
  for (const key of GROK_ENV_KEYS) {
    const value = readEnvValue(key);
    if (value) return { key, token: value };
  }
  for (const key of GROK_ENV_KEYS) {
    const value = readEnvValue(key.toLowerCase());
    if (value) return { key: key.toLowerCase(), token: value };
  }
  return { key: '', token: '' };
};

export const getGrokModel = () => {
  const value = readEnvValue('GROK_MODEL');
  return value || 'grok-beta';
};

export async function generateGrokContent({ apiKey, model, systemPrompt, userPrompt }) {
  if (!apiKey) {
    throw new Error('Grok API key missing.');
  }
  const chosenModel = model || getGrokModel();
  const url = `https://api.x.ai/v1/${encodeURIComponent(chosenModel)}:generateContent`;
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
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const message = errorText.slice(0, 500) || response.statusText || 'Unknown Grok API error';
    const err = new Error(`Grok API error ${response.status}: ${message}`);
    err.status = response.status;
    throw err;
  }

  const payload = await response.json();
  const text = payload?.candidates?.flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n');

  return {
    model: chosenModel,
    text: (text || '').trim(),
    payload,
  };
}

export default {
  GROK_ENV_KEYS,
  getGrokKeyDetail,
  getGrokModel,
  generateGrokContent,
};
