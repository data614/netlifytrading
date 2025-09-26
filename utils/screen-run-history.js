const DEFAULT_STORAGE_KEY = 'netlifytrading.quantScreener.runHistory.v1';
const MAX_ENTRIES = 20;

const createMemoryStorage = () => {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      data.set(key, String(value));
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
};

const resolveStorage = (storage, key) => {
  if (storage) return storage;
  if (typeof window === 'undefined') return createMemoryStorage();
  const driver = window.localStorage;
  if (!driver) return createMemoryStorage();
  try {
    const probe = `${key}.__probe__`;
    driver.setItem(probe, '1');
    driver.removeItem(probe);
    return driver;
  } catch (error) {
    console.warn('Run history storage unavailable, falling back to memory store.', error);
    return createMemoryStorage();
  }
};

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toCount = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num);
};

const normalizeString = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeSymbol = (value) => {
  const str = normalizeString(value);
  return str.toUpperCase();
};

const cloneMetrics = (metrics) => {
  if (!metrics) {
    return {
      count: 0,
      avgUpside: null,
      medianUpside: null,
      positiveUpsideCount: 0,
      negativeUpsideCount: 0,
      zeroUpsideCount: 0,
      totalMarketCap: null,
      averageMarketCap: null,
      bestUpside: null,
      worstUpside: null,
      bestMomentum: null,
      momentumAverage: null,
      momentumMedian: null,
      sectorLeaders: [],
    };
  }

  const sanitizeExtrema = (extrema) => {
    if (!extrema || typeof extrema !== 'object') return null;
    const symbol = normalizeSymbol(extrema.symbol);
    const value = toNumber(extrema.value);
    if (!symbol || value === null) return null;
    return { symbol, value };
  };

  const sanitizeSector = (sector) => {
    if (!sector || typeof sector !== 'object') return null;
    const name = normalizeString(sector.name);
    if (!name) return null;
    return {
      name,
      count: toCount(sector.count),
      weight: toNumber(sector.weight),
      averageUpside: toNumber(sector.averageUpside),
    };
  };

  const sanitized = {
    count: toCount(metrics.count),
    avgUpside: toNumber(metrics.avgUpside),
    medianUpside: toNumber(metrics.medianUpside),
    positiveUpsideCount: toCount(metrics.positiveUpsideCount),
    negativeUpsideCount: toCount(metrics.negativeUpsideCount),
    zeroUpsideCount: toCount(metrics.zeroUpsideCount),
    totalMarketCap: toNumber(metrics.totalMarketCap),
    averageMarketCap: toNumber(metrics.averageMarketCap),
    bestUpside: sanitizeExtrema(metrics.bestUpside),
    worstUpside: sanitizeExtrema(metrics.worstUpside),
    bestMomentum: sanitizeExtrema(metrics.bestMomentum),
    momentumAverage: toNumber(metrics.momentumAverage),
    momentumMedian: toNumber(metrics.momentumMedian),
    sectorLeaders: Array.isArray(metrics.sectorLeaders)
      ? metrics.sectorLeaders.map(sanitizeSector).filter(Boolean).slice(0, 5)
      : [],
  };

  return sanitized;
};

const sanitizeFilters = (filters) => {
  const base = {
    minUpside: null,
    maxUpside: null,
    marketCapMin: null,
    marketCapMax: null,
    batchCap: null,
    sectors: [],
  };
  if (!filters || typeof filters !== 'object') return base;

  const resolveSectors = (value) => {
    if (Array.isArray(value)) {
      return value.map(normalizeString).filter(Boolean).slice(0, 12);
    }
    if (typeof value === 'string') {
      return value
        .split(/[\n,]+/)
        .map(normalizeString)
        .filter(Boolean)
        .slice(0, 12);
    }
    return [];
  };

  return {
    minUpside: toNumber(filters.minUpside),
    maxUpside: toNumber(filters.maxUpside),
    marketCapMin: toNumber(filters.marketCapMin),
    marketCapMax: toNumber(filters.marketCapMax),
    batchCap: toCount(filters.batchCap) || null,
    sectors: resolveSectors(filters.sectors),
  };
};

const sanitizeSort = (sort) => {
  const key = normalizeString(sort && sort.key);
  const direction = sort && sort.direction === 'asc' ? 'asc' : 'desc';
  return {
    key: key || 'upside',
    direction,
  };
};

const sanitizeUniverse = (universe, limit = 30) => {
  if (!universe) return [];
  const tokens = Array.isArray(universe)
    ? universe.map(normalizeSymbol)
    : String(universe)
        .split(/[\s,]+/)
        .map(normalizeSymbol);
  return tokens.filter(Boolean).slice(0, limit);
};

const sanitizeEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const timestamp = toNumber(entry.timestamp) ?? Date.now();
  const universeCount = toCount(entry.universeCount || entry.universeSize);
  const matches = toCount(entry.matches || entry.matchesCount || entry.results);
  const duration = toNumber(entry.durationMs);
  const reachedCap = Boolean(entry.reachedCap);
  const errorCount = toCount(entry.errorCount || entry.errors);

  const sanitized = {
    timestamp,
    universeCount,
    matches,
    durationMs: duration !== null ? Math.max(0, Math.round(duration)) : null,
    reachedCap,
    errorCount,
    filters: sanitizeFilters(entry.filters || {}),
    sort: sanitizeSort(entry.sort || {}),
    universeSample: sanitizeUniverse(entry.universeSample || entry.universe),
    metrics: cloneMetrics(entry.metrics),
  };

  return sanitized;
};

const sanitizeEntries = (entries) => {
  if (!Array.isArray(entries)) return [];
  const deduped = new Map();
  for (const candidate of entries) {
    const sanitized = sanitizeEntry(candidate);
    if (!sanitized) continue;
    deduped.set(sanitized.timestamp, sanitized);
  }
  return Array.from(deduped.values()).sort((a, b) => b.timestamp - a.timestamp);
};

const cloneEntry = (entry) => ({
  timestamp: entry.timestamp,
  universeCount: entry.universeCount,
  matches: entry.matches,
  durationMs: entry.durationMs,
  reachedCap: entry.reachedCap,
  errorCount: entry.errorCount,
  filters: { ...entry.filters, sectors: [...entry.filters.sectors] },
  sort: { ...entry.sort },
  universeSample: [...entry.universeSample],
  metrics: {
    ...entry.metrics,
    bestUpside: entry.metrics.bestUpside ? { ...entry.metrics.bestUpside } : null,
    worstUpside: entry.metrics.worstUpside ? { ...entry.metrics.worstUpside } : null,
    bestMomentum: entry.metrics.bestMomentum ? { ...entry.metrics.bestMomentum } : null,
    sectorLeaders: entry.metrics.sectorLeaders.map((leader) => ({ ...leader })),
  },
});

export function createRunHistoryStore({ storage: explicitStorage, key = DEFAULT_STORAGE_KEY, maxEntries = MAX_ENTRIES } = {}) {
  const storage = resolveStorage(explicitStorage, key);
  let snapshot = [];

  const read = () => {
    if (snapshot.length) {
      return snapshot.map(cloneEntry);
    }

    const raw = storage.getItem(key);
    if (!raw) {
      snapshot = [];
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      snapshot = sanitizeEntries(parsed);
      return snapshot.map(cloneEntry);
    } catch (error) {
      console.warn('Failed to parse quant screener run history. Resetting state.', error);
      snapshot = [];
      return [];
    }
  };

  const persist = (entries) => {
    snapshot = sanitizeEntries(entries);
    const serialized = JSON.stringify(snapshot);
    try {
      storage.setItem(key, serialized);
    } catch (error) {
      console.warn('Failed to persist quant screener run history.', error);
    }
    return snapshot.map(cloneEntry);
  };

  const list = () => {
    return read();
  };

  const latest = () => {
    const entries = read();
    return entries.length ? entries[0] : null;
  };

  const record = (entry) => {
    const sanitized = sanitizeEntry(entry);
    if (!sanitized) {
      throw new TypeError('Run history entry must be a non-null object.');
    }
    const entries = read();
    const filtered = entries.filter((candidate) => candidate.timestamp !== sanitized.timestamp);
    filtered.push(sanitized);
    filtered.sort((a, b) => b.timestamp - a.timestamp);
    while (filtered.length > maxEntries) {
      filtered.pop();
    }
    persist(filtered);
    return sanitized;
  };

  const clear = () => {
    snapshot = [];
    try {
      storage.removeItem(key);
    } catch (error) {
      console.warn('Failed to clear quant screener run history.', error);
    }
  };

  return { key, list, latest, record, clear };
}

export const SCREEN_RUN_HISTORY_STORAGE_KEY = DEFAULT_STORAGE_KEY;
