const DEFAULT_HEADERS = { 'content-type': 'application/json' };
const BASE_PATH = '';

const errorMessages = {
  network: 'We were unable to reach the market data service. Please check your connection and try again.',
  generic: 'The trading desk encountered an unexpected issue. Please retry in a moment.',
};

async function parseJsonResponse(resp) {
  if (!resp) throw new Error('Response missing');
  const text = await resp.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error('Failed to parse JSON payload', err, text.slice(0, 200));
    throw new Error('Invalid response received from the server.');
  }
}

function buildUrl(path, params = {}) {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, value);
  });
  return url;
}

async function safeFetch(url, init) {
  try {
    const resp = await fetch(url, init);
    if (!resp.ok) {
      const message = await resp.text();
      throw new Error(message || `Request failed with ${resp.status}`);
    }
    return resp;
  } catch (err) {
    console.error('API client fetch failed', err);
    throw new Error(errorMessages.network);
  }
}

export async function searchSymbols(query, { exchange = '', limit = 15 } = {}) {
  if (!query || query.trim().length < 1) return [];
  const url = buildUrl(`${BASE_PATH}/.netlify/functions/search`, { q: query.trim(), exchange, limit });
  const resp = await safeFetch(url);
  const payload = await parseJsonResponse(resp);
  return Array.isArray(payload?.data) ? payload.data : [];
}

export async function fetchPriceSeries(symbol, { mode = 'eod', interval = '1day', limit = 120, exchange = '' } = {}) {
  const params = { symbol, limit };
  if (mode === 'intraday') {
    params.kind = 'intraday';
    params.interval = interval;
  } else if (mode === 'intraday_latest') {
    params.kind = 'intraday_latest';
  } else if (mode === 'eod_latest') {
    params.kind = 'eod_latest';
  } else {
    params.kind = 'eod';
  }
  if (exchange) params.exchange = exchange;
  const url = buildUrl(`${BASE_PATH}/.netlify/functions/tiingo`, params);
  const resp = await safeFetch(url);
  const payload = await parseJsonResponse(resp);
  return {
    series: Array.isArray(payload?.data) ? payload.data : [],
    warning: payload?.warning || '',
    raw: payload,
  };
}

export async function fetchCompanyIntel(symbol, exchange = '') {
  const url = buildUrl(`${BASE_PATH}/.netlify/functions/companyIntel`, { symbol, exchange });
  const resp = await safeFetch(url);
  const payload = await parseJsonResponse(resp);
  return payload;
}

export async function requestAiInsight({ symbol, timeframe, objectives, intel, priceSummary }) {
  const url = `${BASE_PATH}/.netlify/functions/aiAnalyst`;
  const body = JSON.stringify({ symbol, timeframe, objectives, intel, priceSummary });
  const resp = await safeFetch(url, { method: 'POST', headers: DEFAULT_HEADERS, body });
  const payload = await parseJsonResponse(resp);
  return payload;
}

export function formatCurrency(value, currency = 'USD') {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: value >= 100 ? 0 : 2 }).format(value);
  } catch (err) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  }
}

export function formatNumber(value, options = {}) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return '—';
  const { maximumFractionDigits = 2, minimumFractionDigits, style } = options;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits, minimumFractionDigits, style }).format(value);
}

export function formatPercent(value, fractionDigits = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

export function formatDate(value) {
  if (!value) return '—';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    return value;
  }
}

export function debounce(fn, delay = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

export function computeReturns(series) {
  const closes = series.map((point) => Number(point?.close ?? point?.price ?? 0)).filter((v) => Number.isFinite(v));
  const out = [];
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const current = closes[i];
    if (prev > 0) out.push((current - prev) / prev);
  }
  return out;
}

export function computeVolatility(series, periodsPerYear = 252) {
  const returns = computeReturns(series);
  if (!returns.length) return 0;
  const avg = returns.reduce((sum, v) => sum + v, 0) / returns.length;
  const variance = returns.reduce((sum, v) => sum + (v - avg) ** 2, 0) / returns.length;
  return Math.sqrt(variance * periodsPerYear);
}

export function computeMaxDrawdown(series) {
  let peak = -Infinity;
  let maxDrawdown = 0;
  series.forEach((point) => {
    const price = Number(point?.close ?? point?.price ?? 0);
    if (!Number.isFinite(price)) return;
    if (price > peak) peak = price;
    if (peak > 0) {
      const drawdown = (price - peak) / peak;
      if (drawdown < maxDrawdown) maxDrawdown = drawdown;
    }
  });
  return Math.abs(maxDrawdown);
}

export function movingAverage(series, window = 20) {
  const closes = series.map((point) => Number(point?.close ?? point?.price ?? 0)).filter((v) => Number.isFinite(v));
  if (closes.length < window) return [];
  const out = [];
  for (let i = window - 1; i < closes.length; i += 1) {
    const slice = closes.slice(i - window + 1, i + 1);
    const avg = slice.reduce((sum, v) => sum + v, 0) / slice.length;
    out.push({ index: i, value: avg });
  }
  return out;
}

export function compoundGrowthRate(series) {
  if (!series.length) return 0;
  const first = Number(series[0]?.close ?? series[0]?.price);
  const last = Number(series[series.length - 1]?.close ?? series[series.length - 1]?.price);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) return 0;
  const periods = series.length - 1;
  if (periods <= 0) return 0;
  return (last / first) ** (1 / periods) - 1;
}

export function formatMillions(value, currency = 'USD') {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  const millions = value / 1_000_000;
  return `${formatCurrency(millions, currency)}`.replace('$', '$') + 'M';
}

