const CODEX_ENV_KEYS = [
  'CHATGPT_CODEX_API_KEY',
  'CHATGPT_API_KEY',
  'OPENAI_API_KEY',
  'REACT_APP_OPENAI_API_KEY',
];

const readEnvValue = (key) => {
  const raw = process.env?.[key];
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  return trimmed || '';
};

export const getCodexKeyDetail = () => {
  for (const key of CODEX_ENV_KEYS) {
    const value = readEnvValue(key);
    if (value) return { key, token: value };
  }
  for (const key of CODEX_ENV_KEYS) {
    const value = readEnvValue(key.toLowerCase());
    if (value) return { key: key.toLowerCase(), token: value };
  }
  return { key: '', token: '' };
};

export const getCodexModel = () => {
  const value = readEnvValue('CHATGPT_CODEX_MODEL');
  return value || 'gpt-4.1-mini';
};

export async function generateCodexContent({ apiKey, model, systemPrompt, userPrompt }) {
  if (!apiKey) {
    throw new Error('ChatGPT Codex API key missing.');
  }
  const chosenModel = model || getCodexModel();
  const url = 'https://api.openai.com/v1/chat/completions';
  const body = {
    model: chosenModel,
    temperature: 0.2,
    messages: [
      systemPrompt ? { role: 'system', content: systemPrompt } : null,
      { role: 'user', content: userPrompt },
    ].filter(Boolean),
  };

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
    const message = errorText.slice(0, 500) || response.statusText || 'Unknown ChatGPT Codex error';
    const err = new Error(`ChatGPT Codex error ${response.status}: ${message}`);
    err.status = response.status;
    throw err;
  }

  const payload = await response.json();
  const text = payload?.choices?.map((choice) => choice?.message?.content || '')
    .filter(Boolean)
    .join('\n')
    .trim();

  return {
    model: chosenModel,
    text: text || '',
    payload,
  };
}

export default {
  CODEX_ENV_KEYS,
  getCodexKeyDetail,
  getCodexModel,
  generateCodexContent,
};
