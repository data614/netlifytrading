const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const toFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const clampNumber = (value, min, max) => {
  const num = toFiniteNumber(value);
  if (num === null) return null;
  let clamped = num;
  if (isFiniteNumber(min) && clamped < min) clamped = min;
  if (isFiniteNumber(max) && clamped > max) clamped = max;
  return clamped;
};

const normalizeScore = (value, { min, max, invert = false } = {}) => {
  const num = toFiniteNumber(value);
  if (num === null) return null;
  const hasMin = isFiniteNumber(min);
  const hasMax = isFiniteNumber(max);
  const effectiveMin = hasMin ? min : num;
  const effectiveMax = hasMax ? max : num;
  if (effectiveMax === effectiveMin) return null;
  const clamped = clampNumber(num, effectiveMin, effectiveMax);
  if (clamped === null) return null;
  const ratio = (clamped - effectiveMin) / (effectiveMax - effectiveMin);
  const normalized = invert ? 1 - ratio : ratio;
  return Math.max(0, Math.min(100, normalized * 100));
};

export const VALUATION_RADAR_LABELS = ['P/E', 'P/S', 'Analyst Upside', 'AI Score'];

export function computeValuationScores({ price, upside, fundamentals } = {}) {
  const metrics = fundamentals?.metrics || fundamentals || {};
  const derivedPrice = price ?? fundamentals?.price ?? metrics?.price;
  const priceValue = toFiniteNumber(derivedPrice);
  const earningsPerShare = toFiniteNumber(metrics.earningsPerShare ?? metrics.eps);
  const revenuePerShare = toFiniteNumber(
    metrics.revenuePerShare ?? metrics.salesPerShare ?? metrics.revenuePS,
  );

  const rawPeRatio =
    priceValue !== null && earningsPerShare && Math.abs(earningsPerShare) > 1e-6
      ? priceValue / earningsPerShare
      : null;
  const rawPsRatio =
    priceValue !== null && revenuePerShare && Math.abs(revenuePerShare) > 1e-6
      ? priceValue / revenuePerShare
      : null;

  const peRatio = Number.isFinite(rawPeRatio) && rawPeRatio > 0 ? rawPeRatio : null;
  const psRatio = Number.isFinite(rawPsRatio) && rawPsRatio > 0 ? rawPsRatio : null;

  const upsideBase = toFiniteNumber(upside);
  const upsidePercent = upsideBase === null ? null : upsideBase * 100;

  const peScore = normalizeScore(peRatio, { min: 8, max: 40, invert: true });
  const psScore = normalizeScore(psRatio, { min: 1, max: 12, invert: true });
  const upsideScore = normalizeScore(upsidePercent, { min: -20, max: 40 });

  const components = [peScore, psScore, upsideScore].filter((value) => Number.isFinite(value));
  const compositeScore = components.length
    ? components.reduce((sum, value) => sum + value, 0) / components.length
    : null;

  const availableCount = [peRatio, psRatio, upsidePercent].filter((value) => Number.isFinite(value)).length;

  return {
    pe: { ratio: peRatio, score: peScore },
    ps: { ratio: psRatio, score: psScore },
    upside: { percent: upsidePercent, score: upsideScore },
    composite: { score: compositeScore, availableCount },
  };
}

export { toFiniteNumber, normalizeScore };
