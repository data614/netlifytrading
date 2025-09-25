export const TIINGO_TOKEN_ENV_KEYS = [
  'TIINGO_KEY',
  'TIINGO_API_KEY',
  'TIINGO_TOKEN',
  'TIINGO_ACCESS_TOKEN',
  'REACT_APP_TIINGO_KEY',
  'REACT_APP_TIINGO_TOKEN',
  'REACT_APP_API_KEY',
];

const readEnvValue = (key) => {
  const raw = process.env?.[key];
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  return trimmed ? trimmed : '';
};

const looksLikeToken = (v) => {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s) return false;
  if (/^(true|false)$/i.test(s)) return false;
  // Tiingo tokens are typically long hex strings; accept 24-64 hex/alnum
  return /^[a-f0-9]{24,64}$/i.test(s);
};

export const getTiingoTokenDetail = () => {
  // 1) Preferred: first recognized key with a value that looks like a token
  for (const key of TIINGO_TOKEN_ENV_KEYS) {
    const value = readEnvValue(key);
    if (looksLikeToken(value)) return { key, token: value };
  }
  // 2) Case-insensitive keys (common mistake on Linux/Netlify)
  for (const key of TIINGO_TOKEN_ENV_KEYS) {
    const value = readEnvValue(key.toLowerCase());
    if (looksLikeToken(value)) return { key: key.toLowerCase(), token: value };
  }
  // 3) Scan all env values for a token-like value
  for (const [k, v] of Object.entries(process.env || {})) {
    if (looksLikeToken(v)) return { key: k, token: String(v).trim() };
  }
  // 4) Rare misconfig: token accidentally used as the env var NAME
  for (const k of Object.keys(process.env || {})) {
    if (looksLikeToken(k)) return { key: '(name-as-token)', token: k };
  }
  return { key: '', token: '' };
};

export const getTiingoToken = () => getTiingoTokenDetail().token;

export const isEnvPresent = (key) => readEnvValue(key) !== '';