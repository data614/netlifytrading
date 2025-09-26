const safeNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const defaultFilters = {
  minUpside: null,
  maxUpside: null,
  marketCapMin: null,
  marketCapMax: null,
  sectors: [],
};

export const mergeFilters = (filters = {}) => ({ ...defaultFilters, ...filters });

export function computeRow(symbol, data) {
  const valuation = data?.valuation?.valuation || data?.valuation;
  const valuationRoot = data?.valuation || {};
  const overview = data?.overview || {};
  const fundamentals = valuationRoot?.fundamentals || {};
  const metrics = fundamentals?.metrics || {};
  const price = valuationRoot?.price ?? valuation?.price ?? valuationRoot?.quote?.price;
  const fairValue = valuation?.fairValue ?? null;
  const upside = price && fairValue ? ((fairValue - price) / price) * 100 : null;
  let marketCap = safeNumber(overview.marketCap);
  if (!Number.isFinite(marketCap)) {
    const shares = safeNumber(overview.sharesOutstanding ?? metrics.sharesOutstanding);
    if (Number.isFinite(shares) && Number.isFinite(price)) {
      marketCap = price * shares;
    } else {
      marketCap = null;
    }
  }
  const sector = overview.sector || fundamentals.sector || fundamentals.profile?.sector || '';
  const industry = overview.industry || fundamentals.industry || fundamentals.profile?.industry || '';
  const momentum = (() => {
    if (!Array.isArray(data?.trend) || data.trend.length < 2) return 0;
    const first = Number(data.trend[0]?.close ?? data.trend[0]?.price);
    const last = Number(data.trend[data.trend.length - 1]?.close ?? data.trend[data.trend.length - 1]?.price);
    if (!Number.isFinite(first) || !Number.isFinite(last) || Math.abs(first) < 1e-6) return 0;
    return ((last - first) / first) * 100;
  })();
  const remark = (data?.aiSummary || '').split('. ').slice(0, 2).join('. ');

  return {
    symbol,
    sector,
    industry,
    price,
    fairValue,
    upside,
    marketCap,
    momentum,
    summary: remark,
    raw: data,
  };
}

export function passesFilters(row, filters = defaultFilters) {
  const merged = mergeFilters(filters);
  const { minUpside, maxUpside, marketCapMin, marketCapMax, sectors } = merged;

  if (minUpside !== null) {
    if (!Number.isFinite(row.upside) || row.upside < minUpside) return false;
  }

  if (maxUpside !== null) {
    if (!Number.isFinite(row.upside) || row.upside > maxUpside) return false;
  }

  if (marketCapMin !== null) {
    if (!Number.isFinite(row.marketCap) || row.marketCap < marketCapMin) return false;
  }

  if (marketCapMax !== null) {
    if (!Number.isFinite(row.marketCap) || row.marketCap > marketCapMax) return false;
  }

  if (sectors.length) {
    const rowSector = (row.sector || '').toLowerCase();
    if (!rowSector) return false;
    const matches = sectors.some((sector) => rowSector.includes(sector));
    if (!matches) return false;
  }

  return true;
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export function suggestConcurrency(total, explicit) {
  if (!Number.isFinite(total) || total <= 0) return 1;
  if (Number.isFinite(explicit) && explicit > 0) {
    return clamp(Math.floor(explicit), 1, total);
  }
  if (total <= 5) return 1;
  if (total <= 20) return 3;
  if (total <= 50) return 5;
  if (total <= 100) return 6;
  return 8;
}

export async function screenUniverse(universe, options) {
  const {
    fetchIntel,
    computeRow: compute = computeRow,
    passesFilters: filterRow = passesFilters,
    filters = defaultFilters,
    batchCap = Infinity,
    concurrency,
    onItemComplete,
    onError,
  } = options || {};

  if (!Array.isArray(universe)) {
    throw new TypeError('Universe must be an array of symbols.');
  }
  if (typeof fetchIntel !== 'function') {
    throw new TypeError('fetchIntel must be a function.');
  }

  const total = universe.length;
  if (!total) {
    return { matches: [], processed: [], errors: [], reachedCap: false };
  }

  const parallel = suggestConcurrency(total, concurrency);
  const matches = [];
  const processed = [];
  const errors = [];
  let processedCount = 0;

  for (let start = 0; start < total; start += parallel) {
    if (matches.length >= batchCap) break;
    const slice = universe.slice(start, start + parallel);
    const settled = await Promise.allSettled(
      slice.map((symbol) =>
        Promise.resolve()
          .then(() => fetchIntel(symbol))
          .then((payload) => ({ symbol, payload }))
      )
    );

    for (let offset = 0; offset < settled.length; offset += 1) {
      const fallbackSymbol = slice[offset];
      const outcome = settled[offset];
      const index = start + offset;

      if (outcome.status === 'fulfilled') {
        const { symbol = fallbackSymbol, payload } = outcome.value || {};
        const row = compute(symbol, payload?.data);
        processed.push(row);
        processedCount += 1;
        const passes = filterRow(row, filters);
        if (passes) {
          matches.push(row);
        }
        const reachedCap = matches.length >= batchCap;
        onItemComplete?.({
          symbol,
          index,
          row,
          passes,
          total,
          processedCount,
          matchesCount: matches.length,
          reachedCap,
        });
        if (reachedCap) break;
      } else {
        const error = outcome.reason;
        const symbol = fallbackSymbol;
        errors.push({ symbol, error });
        processedCount += 1;
        onError?.({ symbol, index, error, total, processedCount });
      }
    }

    if (matches.length >= batchCap) break;
  }

  const reachedCap = matches.length >= batchCap && Number.isFinite(batchCap);
  return { matches, processed, errors, reachedCap };
}
