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

export const getTiingoToken = () => {
  for (const key of TIINGO_TOKEN_ENV_KEYS) {
    const value = readEnvValue(key);
    if (value) return value;
  }
  return '';
};

export const isEnvPresent = (key) => readEnvValue(key) !== '';
