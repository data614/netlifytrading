import { getResearchLabInsights, getScreenerSnapshot } from './research-data.js';

const API_ROOT = '/api/tiingo';

function buildUrl(params = {}) {
  const url = new URL(API_ROOT, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, value);
  });
  return url.toString();
}

async function requestTiingo(params) {
  const url = buildUrl(params);
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.warning || data?.error || response.statusText;
    const error = new Error(message || 'Request failed');
    error.response = data;
    throw error;
  }

  return data;
}

const RANGE_LIMITS = {
  '1D': { kind: 'intraday', interval: '1Min', limit: 390 },
  '5D': { kind: 'intraday', interval: '5Min', limit: 400 },
  '1M': { kind: 'eod', limit: 30 },
  '3M': { kind: 'eod', limit: 90 },
  '6M': { kind: 'eod', limit: 180 },
  '1Y': { kind: 'eod', limit: 365 },
  '2Y': { kind: 'eod', limit: 365 * 2 },
  '5Y': { kind: 'eod', limit: 365 * 5 },
  MAX: { kind: 'eod', limit: 400 },
};

export async function fetchPriceHistory(symbol, rangeKey = '6M') {
  const upper = (symbol || '').trim().toUpperCase() || 'AAPL';
  const range = RANGE_LIMITS[rangeKey] || RANGE_LIMITS['6M'];
  const params = { symbol: upper, kind: range.kind, limit: range.limit };
  if (range.interval) params.interval = range.interval;

  const payload = await requestTiingo(params);
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const meta = payload?.meta || {};
  const warning = payload?.warning || '';

  return { symbol: payload?.symbol || upper, rows, meta, warning };
}

export async function fetchLatestQuote(symbol) {
  const upper = (symbol || '').trim().toUpperCase() || 'AAPL';
  const payload = await requestTiingo({ symbol: upper, kind: 'intraday_latest' });
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return { symbol: payload?.symbol || upper, row: rows[0] || null, meta: payload?.meta || {}, warning: payload?.warning || '' };
}

export async function fetchCompanyNews(symbol, { limit = 20 } = {}) {
  const upper = (symbol || '').trim().toUpperCase() || 'AAPL';
  const payload = await requestTiingo({ symbol: upper, kind: 'news', limit });
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return { symbol: payload?.symbol || upper, rows, meta: payload?.meta || {}, warning: payload?.warning || '' };
}

export async function fetchSecFilings(symbol, { limit = 20 } = {}) {
  const upper = (symbol || '').trim().toUpperCase() || 'AAPL';
  const payload = await requestTiingo({ symbol: upper, kind: 'filings', limit });
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return { symbol: payload?.symbol || upper, rows, meta: payload?.meta || {}, warning: payload?.warning || '' };
}

export function describeRange(rangeKey) {
  switch (rangeKey) {
    case '1D':
      return '1 Day';
    case '5D':
      return '5 Days';
    case '1M':
      return '1 Month';
    case '3M':
      return '3 Months';
    case '6M':
      return '6 Months';
    case '1Y':
      return '1 Year';
    case '2Y':
      return '2 Years';
    case '5Y':
      return '5 Years';
    case 'MAX':
      return 'Max Available';
    default:
      return rangeKey;
  }
}

export const AVAILABLE_RANGES = Object.keys(RANGE_LIMITS);

export async function fetchValuationSnapshot(symbol) {
  const upper = (symbol || '').trim().toUpperCase() || 'AAPL';
  const payload = await requestTiingo({ symbol: upper, kind: 'valuation' });
  const data = payload?.data || null;
  return { symbol: payload?.symbol || upper, snapshot: data, meta: payload?.meta || {}, warning: payload?.warning || '' };
}

export async function fetchResearchLabSnapshot(symbol) {
  const data = getResearchLabInsights(symbol);
  return { ...data };
}

export async function fetchScreenerPreview(symbol) {
  const data = getScreenerSnapshot(symbol);
  return { ...data };
}
