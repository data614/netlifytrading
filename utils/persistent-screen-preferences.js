const STORAGE_KEY = 'netlifytrading.quantScreener.preferences.v1';

const FALLBACK_DEFAULTS = Object.freeze({
  universe: '',
  filters: Object.freeze({
    minUpside: '',
    maxUpside: '',
    marketCapMin: '',
    marketCapMax: '',
    sectors: '',
    batchCap: '',
  }),
  sort: Object.freeze({
    key: 'upside',
    direction: 'desc',
  }),
  lastRun: null,
});

const FILTER_KEYS = Object.keys(FALLBACK_DEFAULTS.filters);

const sanitizeString = (value, fallback = '') => {
  if (value === undefined || value === null) return fallback ?? '';
  if (typeof value === 'string') return value;
  return String(value);
};

const sanitizeSort = (sort, fallback) => {
  const base = fallback ? { ...fallback } : { key: 'upside', direction: 'desc' };
  if (!sort || typeof sort !== 'object') return base;
  const key = typeof sort.key === 'string' && sort.key.trim() ? sort.key.trim() : base.key;
  const direction = sort.direction === 'asc' ? 'asc' : sort.direction === 'desc' ? 'desc' : base.direction;
  return { key, direction };
};

const sanitizeFilters = (filters, fallback) => {
  const base = fallback ? { ...fallback } : { ...FALLBACK_DEFAULTS.filters };
  const result = { ...base };
  if (!filters || typeof filters !== 'object') return result;
  for (const key of FILTER_KEYS) {
    if (!(key in filters)) continue;
    const value = filters[key];
    result[key] = value === null ? '' : sanitizeString(value, result[key]);
  }
  return result;
};

const sanitizeDuration = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num);
};

const sanitizeCount = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num);
};

const sanitizeLastRun = (lastRun) => {
  if (!lastRun || typeof lastRun !== 'object') return null;
  const timestampValue = Number(lastRun.timestamp);
  const timestamp = Number.isFinite(timestampValue) ? timestampValue : Date.now();
  return {
    timestamp,
    universeCount: sanitizeCount(lastRun.universeCount),
    matchesCount: sanitizeCount(lastRun.matchesCount),
    reachedCap: Boolean(lastRun.reachedCap),
    durationMs: sanitizeDuration(lastRun.durationMs),
  };
};

const cloneLastRun = (lastRun) => {
  if (!lastRun) return null;
  return {
    timestamp: lastRun.timestamp,
    universeCount: lastRun.universeCount,
    matchesCount: lastRun.matchesCount,
    reachedCap: Boolean(lastRun.reachedCap),
    durationMs: lastRun.durationMs ?? null,
  };
};

const cloneSnapshot = (snapshot) => ({
  universe: snapshot.universe ?? '',
  filters: { ...snapshot.filters },
  sort: { ...snapshot.sort },
  lastRun: cloneLastRun(snapshot.lastRun),
});

const sanitizeSnapshot = (raw, fallback = FALLBACK_DEFAULTS) => {
  const base = cloneSnapshot(fallback);
  const payload = raw && typeof raw === 'object' ? raw : {};
  const snapshot = cloneSnapshot(base);
  snapshot.universe = sanitizeString(payload.universe, base.universe);
  snapshot.filters = sanitizeFilters(payload.filters, base.filters);
  snapshot.sort = sanitizeSort(payload.sort, base.sort);
  if (payload.lastRun === null) {
    snapshot.lastRun = null;
  } else if (payload.lastRun !== undefined) {
    snapshot.lastRun = sanitizeLastRun(payload.lastRun);
  }
  return snapshot;
};

const createDefaultSnapshot = (overrides = {}) => {
  const merged = {
    ...FALLBACK_DEFAULTS,
    ...overrides,
    filters: { ...FALLBACK_DEFAULTS.filters, ...(overrides.filters || {}) },
    sort: { ...FALLBACK_DEFAULTS.sort, ...(overrides.sort || {}) },
  };
  return sanitizeSnapshot(merged);
};

const resolveStorageDriver = (storage, key) => {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  const driver = window.localStorage;
  if (!driver) return null;
  try {
    const probeKey = `${key}.__probe__`;
    driver.setItem(probeKey, '1');
    driver.removeItem(probeKey);
    return driver;
  } catch (error) {
    console.warn('Local storage unavailable for quant screener preferences.', error);
    return null;
  }
};

export function createScreenPreferenceStore(options = {}) {
  const { storage: explicitStorage, key = STORAGE_KEY, defaults = {} } = options;
  const defaultsSnapshot = createDefaultSnapshot(defaults);
  const storage = resolveStorageDriver(explicitStorage, key);

  const cloneDefaults = () => cloneSnapshot(defaultsSnapshot);

  const load = () => {
    if (!storage) return cloneDefaults();
    const raw = storage.getItem(key);
    if (!raw) return cloneDefaults();
    try {
      const parsed = JSON.parse(raw);
      return sanitizeSnapshot(parsed, defaultsSnapshot);
    } catch (error) {
      console.warn('Failed to parse quant screener preferences. Resetting to defaults.', error);
      return cloneDefaults();
    }
  };

  const save = (snapshot) => {
    const sanitized = sanitizeSnapshot(snapshot, defaultsSnapshot);
    if (storage) {
      try {
        storage.setItem(key, JSON.stringify(sanitized));
      } catch (error) {
        console.warn('Failed to persist quant screener preferences.', error);
      }
    }
    return sanitized;
  };

  const merge = (partial) => {
    const current = load();
    const update = partial && typeof partial === 'object' ? partial : {};
    const composed = {
      ...current,
      ...update,
      filters: { ...current.filters, ...(update.filters || {}) },
      sort: { ...current.sort, ...(update.sort || {}) },
    };
    if (update.lastRun === undefined) {
      composed.lastRun = cloneLastRun(current.lastRun);
    } else {
      composed.lastRun = update.lastRun === null ? null : sanitizeLastRun(update.lastRun);
    }
    return save(composed);
  };

  const clear = () => {
    if (storage) {
      try {
        storage.removeItem(key);
      } catch (error) {
        console.warn('Failed to clear quant screener preferences.', error);
      }
    }
    return cloneDefaults();
  };

  return { key, load, save, merge, clear, defaults: cloneDefaults };
}

export const SCREEN_PREFERENCES_STORAGE_KEY = STORAGE_KEY;
