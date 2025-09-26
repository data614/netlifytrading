const STORAGE_KEY = 'tradingDesk.preferences';

const FALLBACK_STORAGE = (() => {
  const memory = new Map();
  return {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => {
      memory.set(key, String(value));
    },
    removeItem: (key) => {
      memory.delete(key);
    },
  };
})();

function getStorage() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch (error) {
    console.warn('Preferences storage unavailable, using in-memory fallback.', error);
  }
  return FALLBACK_STORAGE;
}

const VALID_TIMEFRAMES = new Set(['1D', '1W', '1M', '3M', '6M', '1Y']);

const DEFAULT_PREFERENCES = {
  symbol: 'AAPL',
  symbolName: 'Apple Inc.',
  exchange: 'XNAS',
  timeframe: '1D',
  searchExchange: '',
  newsSource: 'All',
};

function sanitiseString(value, { upper = false, trim = true } = {}) {
  if (typeof value !== 'string') return '';
  let result = value;
  if (trim) result = result.trim();
  if (upper) result = result.toUpperCase();
  return result;
}

function sanitisePreferences(raw = {}) {
  const base = { ...DEFAULT_PREFERENCES };
  if (!raw || typeof raw !== 'object') {
    return base;
  }

  const next = { ...base };

  if (raw.symbol) {
    const symbol = sanitiseString(raw.symbol, { upper: true });
    if (symbol) next.symbol = symbol;
  }

  if (raw.symbolName) {
    const name = sanitiseString(raw.symbolName);
    if (name) next.symbolName = name;
  }

  if (raw.exchange) {
    const exchange = sanitiseString(raw.exchange, { upper: true });
    if (exchange) next.exchange = exchange;
  }

  if (raw.timeframe) {
    const timeframe = sanitiseString(raw.timeframe, { upper: true });
    if (VALID_TIMEFRAMES.has(timeframe)) {
      next.timeframe = timeframe;
    }
  }

  if (raw.searchExchange !== undefined) {
    const exchange = sanitiseString(raw.searchExchange, { upper: true });
    next.searchExchange = exchange;
  }

  if (raw.newsSource) {
    const source = sanitiseString(raw.newsSource, { trim: true });
    if (source) next.newsSource = source;
  }

  return next;
}

export function loadPreferences() {
  const storage = getStorage();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const parsed = JSON.parse(raw);
    return sanitisePreferences(parsed);
  } catch (error) {
    console.warn('Failed to load preferences. Falling back to defaults.', error);
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(preferences) {
  const storage = getStorage();
  const next = sanitisePreferences(preferences);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn('Failed to persist preferences.', error);
  }
  return next;
}

export function updatePreferences(partial) {
  const merged = { ...loadPreferences(), ...(partial || {}) };
  return savePreferences(merged);
}

export function clearPreferences() {
  const storage = getStorage();
  try {
    if (storage.removeItem) {
      storage.removeItem(STORAGE_KEY);
    } else {
      storage.setItem(STORAGE_KEY, '');
    }
  } catch (error) {
    console.warn('Failed to clear preferences.', error);
  }
}

export function getDefaultPreferences() {
  return { ...DEFAULT_PREFERENCES };
}

export const PREFERENCE_STORAGE_KEY = STORAGE_KEY;
export const VALID_PREFERENCE_TIMEFRAMES = [...VALID_TIMEFRAMES];
