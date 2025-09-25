const ensureNumber = (value) => {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
};

export const sortByDate = (series = [], key = 'date') =>
  [...series]
    .filter((row) => row && row[key] != null)
    .sort((a, b) => {
      const da = toDate(a[key]);
      const db = toDate(b[key]);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da - db;
    });

export const extractValues = (series = [], key = 'close') =>
  sortByDate(series).map((row) => ensureNumber(row?.[key])).filter((v) => v != null);

export const mean = (values = []) => {
  if (!values.length) return null;
  const total = values.reduce((acc, value) => acc + value, 0);
  return total / values.length;
};

export const standardDeviation = (values = []) => {
  if (!values.length) return null;
  const avg = mean(values);
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return variance == null ? null : Math.sqrt(variance);
};

export const computeReturns = (series = [], valueKey = 'close', mode = 'log') => {
  const values = extractValues(series, valueKey);
  if (values.length < 2) return [];
  const returns = [];
  for (let i = 1; i < values.length; i += 1) {
    const prev = values[i - 1];
    const curr = values[i];
    if (prev && curr) {
      const change = curr / prev;
      returns.push(mode === 'log' ? Math.log(change) : change - 1);
    }
  }
  return returns;
};

export const annualizeVolatility = (returns = [], periodsPerYear = 252) => {
  if (!returns.length) return null;
  const dailyStd = standardDeviation(returns);
  if (dailyStd == null) return null;
  return dailyStd * Math.sqrt(periodsPerYear);
};

export const movingAverage = (values = [], window = 20) => {
  if (!Array.isArray(values) || window <= 0) return [];
  const out = [];
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = ensureNumber(values[i]);
    if (value == null) {
      out.push(null);
      continue;
    }
    sum += value;
    if (i >= window) {
      const drop = ensureNumber(values[i - window]);
      if (drop != null) sum -= drop;
    }
    if (i >= window - 1) {
      out.push(sum / window);
    } else {
      out.push(null);
    }
  }
  return out;
};

export const exponentialMovingAverage = (values = [], window = 20) => {
  if (!Array.isArray(values) || !values.length || window <= 0) return [];
  const k = 2 / (window + 1);
  const out = [];
  let ema = ensureNumber(values[0]);
  out.push(ema);
  for (let i = 1; i < values.length; i += 1) {
    const value = ensureNumber(values[i]);
    if (value == null || ema == null) {
      out.push(ema);
      continue;
    }
    ema = value * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
};

export const maxDrawdown = (values = []) => {
  let peak = -Infinity;
  let maxDd = 0;
  values.forEach((value) => {
    const num = ensureNumber(value);
    if (num == null) return;
    if (num > peak) peak = num;
    const dd = peak > 0 ? (num - peak) / peak : 0;
    if (dd < maxDd) maxDd = dd;
  });
  return maxDd;
};

export const relativeStrengthIndex = (values = [], period = 14) => {
  if (!Array.isArray(values) || values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = ensureNumber(values[i]) - ensureNumber(values[i - 1]);
    if (!Number.isFinite(change)) continue;
    if (change >= 0) gains += change; else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i += 1) {
    const change = ensureNumber(values[i]) - ensureNumber(values[i - 1]);
    if (!Number.isFinite(change)) continue;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
};

export const sharpeRatio = (returns = [], { periodsPerYear = 252, riskFreeRate = 0.02 } = {}) => {
  if (!returns.length) return null;
  const avg = mean(returns);
  const annualReturn = avg * periodsPerYear;
  const vol = annualizeVolatility(returns, periodsPerYear);
  if (!vol || vol === 0) return null;
  return (annualReturn - riskFreeRate) / vol;
};

export const valueAtRisk = (returns = [], { confidence = 0.95 } = {}) => {
  if (!returns.length) return null;
  const sorted = [...returns].sort((a, b) => a - b);
  const index = Math.floor((1 - confidence) * sorted.length);
  return sorted[index] ?? null;
};

export const analyseSeries = (series = [], options = {}) => {
  const { periodsPerYear = 252, volumeKey = 'volume', priceKey = 'close' } = options;
  const sorted = sortByDate(series);
  const closes = sorted.map((row) => ensureNumber(row?.[priceKey])).filter((v) => v != null);
  if (!closes.length) {
    return {
      closes,
      volatility: null,
      sharpe: null,
      drawdown: null,
      rsi: null,
      sma20: null,
      sma50: null,
      averageVolume: null,
    };
  }
  const returns = computeReturns(sorted, priceKey);
  const volatility = annualizeVolatility(returns, periodsPerYear);
  const sharpe = sharpeRatio(returns, { periodsPerYear });
  const drawdown = maxDrawdown(closes);
  const rsi = relativeStrengthIndex(closes);
  const mas = movingAverage(closes, 20);
  const sma20 = mas.length ? mas[mas.length - 1] : null;
  const sma50Series = movingAverage(closes, 50);
  const sma50 = sma50Series.length ? sma50Series[sma50Series.length - 1] : null;
  const volumes = sorted.map((row) => ensureNumber(row?.[volumeKey])).filter((v) => v != null);
  const averageVolume = volumes.length ? mean(volumes.slice(-30)) : null;
  const ema = exponentialMovingAverage(closes, 21);
  const ema21 = ema.length ? ema[ema.length - 1] : null;

  return {
    closes,
    returns,
    volatility,
    sharpe,
    drawdown,
    rsi,
    sma20,
    sma50,
    ema21,
    averageVolume,
  };
};

export const formatPercent = (value, digits = 2) => {
  if (value == null || !Number.isFinite(value)) return '—';
  const pct = value * 100;
  return `${pct.toFixed(digits)}%`;
};

export const formatNumber = (value, digits = 2) => {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1e12) return `${(value / 1e12).toFixed(digits)}T`;
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(digits)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(digits)}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(digits)}K`;
  return value.toFixed(digits);
};

export default {
  analyseSeries,
  annualizeVolatility,
  computeReturns,
  exponentialMovingAverage,
  formatNumber,
  formatPercent,
  maxDrawdown,
  mean,
  movingAverage,
  relativeStrengthIndex,
  sharpeRatio,
  sortByDate,
  standardDeviation,
  valueAtRisk,
};
