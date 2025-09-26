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

const normalizeSymbol = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase();
};

const normalizeSector = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const computeMedian = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
};

const createEmptyExtrema = () => ({ symbol: null, value: null });

const EMPTY_METRICS = Object.freeze({
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
});

const cloneExtrema = (extrema) => {
  if (!extrema || typeof extrema !== 'object') return null;
  const symbol = normalizeSymbol(extrema.symbol);
  const value = toNumber(extrema.value);
  if (!symbol || value === null) return null;
  return { symbol, value };
};

/**
 * Computes aggregate metrics for screener rows, including distribution
 * statistics used for run history and developer tooling.
 *
 * @param {Array<object>} rows
 * @returns {object}
 */
export function computeAggregateMetrics(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ...EMPTY_METRICS, sectorLeaders: [] };
  }

  const metrics = {
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

  const upsides = [];
  const momentumValues = [];
  const sectorStats = new Map();

  let upsideAccumulator = 0;
  let upsideCount = 0;
  let marketCapAccumulator = 0;
  let marketCapCount = 0;
  let momentumAccumulator = 0;

  const bestUpside = createEmptyExtrema();
  const worstUpside = createEmptyExtrema();
  const bestMomentum = createEmptyExtrema();

  for (const candidate of rows) {
    if (!candidate || typeof candidate !== 'object') continue;
    metrics.count += 1;

    const symbol = normalizeSymbol(candidate.symbol);
    const sector = normalizeSector(candidate.sector || candidate.industry || '');
    const upside = toNumber(candidate.upside);
    const momentum = toNumber(candidate.momentum);
    const marketCap = toNumber(candidate.marketCap);

    if (upside !== null) {
      upsides.push(upside);
      upsideAccumulator += upside;
      upsideCount += 1;
      if (upside > 0) metrics.positiveUpsideCount += 1;
      else if (upside < 0) metrics.negativeUpsideCount += 1;
      else metrics.zeroUpsideCount += 1;

      if (bestUpside.value === null || upside > bestUpside.value) {
        bestUpside.symbol = symbol || candidate.symbol || null;
        bestUpside.value = upside;
      }
      if (worstUpside.value === null || upside < worstUpside.value) {
        worstUpside.symbol = symbol || candidate.symbol || null;
        worstUpside.value = upside;
      }
    }

    if (momentum !== null) {
      momentumValues.push(momentum);
      momentumAccumulator += momentum;
      if (bestMomentum.value === null || momentum > bestMomentum.value) {
        bestMomentum.symbol = symbol || candidate.symbol || null;
        bestMomentum.value = momentum;
      }
    }

    if (marketCap !== null) {
      marketCapAccumulator += marketCap;
      marketCapCount += 1;
    }

    if (sector) {
      const key = sector.toLowerCase();
      if (!sectorStats.has(key)) {
        sectorStats.set(key, {
          name: sector,
          count: 0,
          upsideTotal: 0,
          upsideCount: 0,
        });
      }
      const stat = sectorStats.get(key);
      stat.count += 1;
      if (upside !== null) {
        stat.upsideTotal += upside;
        stat.upsideCount += 1;
      }
    }
  }

  if (upsideCount) {
    metrics.avgUpside = upsideAccumulator / upsideCount;
    metrics.medianUpside = computeMedian(upsides);
    metrics.bestUpside = cloneExtrema(bestUpside);
    metrics.worstUpside = cloneExtrema(worstUpside);
  }

  if (marketCapCount) {
    metrics.totalMarketCap = marketCapAccumulator;
    metrics.averageMarketCap = marketCapAccumulator / marketCapCount;
  }

  if (momentumValues.length) {
    metrics.momentumAverage = momentumAccumulator / momentumValues.length;
    metrics.momentumMedian = computeMedian(momentumValues);
    metrics.bestMomentum = cloneExtrema(bestMomentum);
  }

  const leaders = Array.from(sectorStats.values())
    .map((stat) => ({
      name: stat.name,
      count: stat.count,
      weight: metrics.count ? stat.count / metrics.count : 0,
      averageUpside: stat.upsideCount ? stat.upsideTotal / stat.upsideCount : null,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 5);

  metrics.sectorLeaders = leaders;

  return metrics;
}

export function createEmptyAggregateMetrics() {
  return { ...EMPTY_METRICS, sectorLeaders: [] };
}
