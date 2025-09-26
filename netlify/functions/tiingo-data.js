import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTiingoToken, TIINGO_TOKEN_ENV_KEYS } from './lib/env.js';
import { createCache } from './lib/cache.js';
import buildValuationSnapshot, { summarizeValuationNarrative, valuationUtils } from './lib/valuation.js';

// --- Configuration & Constants ---

const API_BASE = 'https://api.tiingo.com';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const corsHeaders = { 'access-control-allow-origin': ALLOWED_ORIGIN };

const DAY_MS = 24 * 60 * 60 * 1000;
const INTRADAY_MS = 5 * 60 * 1000;
const EOD_LOOKBACK_DAYS = 400;
const DEFAULT_EOD_POINTS = 30;
const DEFAULT_INTRADAY_POINTS = 150;
const NEWS_LIMIT = 15;
const DOCUMENT_LIMIT = 10;
const FUNDAMENTAL_LIMIT = 4;
const ACTION_LOOKBACK_DAYS = 365 * 2;

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_DATA_DIR = join(__dirname, '../..', 'data', 'tiingo-mock');
const FALLBACK_SYMBOL = 'GENERIC';
const mockCache = new Map();
const tiingoResponseCache = createCache({ ttl: 60_000, maxEntries: 400 });

// --- Mock Data Generators ---

/**
 * Creates a pseudo-random number generator from a seed string.
 * @param {string} s - The seed string.
 * @returns {() => number} A function that returns a random number between 0 and 1.
 */
function seed(s) {
  let v = 1;
  for (let i = 0; i < s.length; i += 1) {
    v = (v * 33 + s.charCodeAt(i)) >>> 0;
  }
  return () => {
    v = (v * 16807) % 2147483647;
    return (v - 1) / 2147483646;
  };
}

/**
 * Rounds a number to two decimal places, with a floor of 0.01.
 * @param {number} x The number to round.
 * @returns {number} The rounded number.
 */
const round = (x) => Number(Math.max(x, 0.01).toFixed(2));

/**
 * Generates a mock time series for a stock symbol.
 * @param {string} symbol The stock symbol.
 * @param {number} points The number of data points to generate.
 * @param {'eod'|'intraday'} mode The type of series to generate.
 * @returns {object[]} An array of mock price data.
 */
function mockSeries(symbol = 'MOCK', points = 30, mode = 'eod') {
  const rng = seed(symbol.toUpperCase());
  let previousPrice = 100 + rng() * 50;
  const step = mode === 'intraday' ? INTRADAY_MS : DAY_MS;
  const now = Date.now();
  const out = [];

  for (let i = points - 1; i >= 0; i -= 1) {
    const date = new Date(now - i * step);
    const open = round(previousPrice + (rng() - 0.5) * 3);
    const close = round(open + (rng() - 0.5) * 4);
    const high = round(Math.max(open, close) + rng() * 2);
    const low = round(Math.min(open, close) - rng() * 2);

    out.push({
      symbol: symbol.toUpperCase(),
      date: date.toISOString(),
      open,
      high,
      low,
      close,
      last: close,
      price: close,
      previousClose: round(previousPrice),
      volume: Math.floor(1e6 * rng()),
      exchange: '',
      currency: 'USD',
    });
    previousPrice = close;
  }
  return out;
}

/** Generates a single mock quote. */
const mockQuote = (s) => mockSeries(s, 1, 'intraday')[0];

const mockNews = (symbol, limit = NEWS_LIMIT) => {
  const rng = seed(symbol);
  const items = [];
  for (let i = 0; i < limit; i += 1) {
    const daysAgo = i * (1 + Math.floor(rng() * 3));
    const publishedAt = new Date(Date.now() - daysAgo * DAY_MS).toISOString();
    items.push({
      id: `${symbol}-${i}`,
      publishedAt,
      headline: `${symbol} strategic update #${i + 1}`,
      summary: `${symbol} released a mock announcement highlighting corporate developments and performance milestones.`,
      url: `https://example.com/${symbol}/${i}`,
      source: 'SampleWire',
      sentiment: Math.round((rng() - 0.5) * 200) / 100,
      tags: ['Mock', 'Demo'],
    });
  }
  return items;
};

const mockFundamentals = (symbol) => {
  const rng = seed(symbol);
  const price = round(80 + rng() * 40);
  const revenuePerShare = round(50 + rng() * 20);
  const eps = round(4 + rng() * 2);
  const fcfPerShare = round(3 + rng());
  const bookValuePerShare = round(20 + rng() * 5);
  const revenueGrowth = 0.08 + rng() * 0.04;
  const epsGrowth = 0.1 + rng() * 0.03;
  const fcfGrowth = 0.07 + rng() * 0.02;
  const history = [];
  for (let i = 3; i >= 0; i -= 1) {
    history.push({
      reportDate: new Date(Date.now() - i * 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      totalRevenue: revenuePerShare * 100000000,
      netIncome: eps * 90000000,
      freeCashFlow: fcfPerShare * 80000000,
      bookValuePerShare,
      eps,
    });
  }
  return {
    symbol,
    latest: history[history.length - 1],
    history,
    metrics: {
      price,
      earningsPerShare: eps,
      revenuePerShare,
      freeCashFlowPerShare: fcfPerShare,
      bookValuePerShare,
      revenueGrowth,
      epsGrowth,
      fcfGrowth,
      sharesOutstanding: 16000000000,
    },
  };
};

const mockActions = (symbol) => {
  const today = Date.now();
  return {
    symbol,
    dividends: [0, 1, 2].map((i) => ({
      exDate: new Date(today - i * 90 * DAY_MS).toISOString().slice(0, 10),
      amount: round(0.2 + i * 0.02),
      payDate: new Date(today - (i * 90 - 15) * DAY_MS).toISOString().slice(0, 10),
    })),
    splits: [
      {
        exDate: new Date(today - 400 * DAY_MS).toISOString().slice(0, 10),
        numerator: 4,
        denominator: 1,
      },
    ],
  };
};

const mockDocuments = (symbol, limit = DOCUMENT_LIMIT) => mockNews(symbol, limit).map((item, index) => ({
  ...item,
  headline: `${symbol} regulatory filing ${index + 1}`,
  documentType: index % 2 === 0 ? '10-Q' : '10-K',
}));

const mockOverview = (symbol) => {
  const rng = seed(symbol);
  return {
    symbol,
    name: `${symbol} Mock Technologies`,
    exchange: 'NASDAQ',
    industry: 'Software - Infrastructure',
    sector: 'Technology',
    description: `${symbol} Mock Technologies provides illustrative products for demos and offline development scenarios.`,
    website: `https://example.com/${symbol.toLowerCase()}`,
    marketCap: Math.round(200_000_000_000 + rng() * 50_000_000_000),
    sharesOutstanding: 16_000_000_000,
    currency: 'USD',
  };
};

const mockStatements = (symbol) => {
  const fundamentals = mockFundamentals(symbol);
  const toStatement = (keyMap) => fundamentals.history.map((period) => {
    const base = {
      reportDate: period.reportDate,
      period: 'FY',
      currency: 'USD',
    };
    for (const [target, source] of Object.entries(keyMap)) {
      base[target] = toNumber(period[source]) ?? null;
    }
    return base;
  });

  return {
    income: toStatement({
      revenue: 'totalRevenue',
      netIncome: 'netIncome',
      earningsPerShare: 'eps',
    }),
    balanceSheet: toStatement({
      totalAssets: 'totalAssets',
      totalLiabilities: 'totalLiabilities',
      bookValuePerShare: 'bookValuePerShare',
    }),
    cashFlow: toStatement({
      operatingCashFlow: 'freeCashFlow',
      freeCashFlow: 'freeCashFlow',
    }),
  };
};

const mockFilings = (symbol, limit = DOCUMENT_LIMIT) => mockDocuments(symbol, limit).map((doc, index) => ({
  ...doc,
  documentType: index % 3 === 0 ? '8-K' : doc.documentType,
}));

const clone = (value) => {
  if (value == null) return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // fallthrough to JSON clone
    }
  }
  return JSON.parse(JSON.stringify(value));
};

const safeJsonParse = (text) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn('[tiingo] Failed to parse mock data JSON:', error?.message || error);
    return null;
  }
};

async function readMockData(symbol) {
  const upper = symbol.toUpperCase();
  if (mockCache.has(upper)) return mockCache.get(upper);

  const candidates = [upper];
  if (!candidates.includes(FALLBACK_SYMBOL)) {
    candidates.push(FALLBACK_SYMBOL);
  }

  for (const candidate of candidates) {
    const filePath = join(MOCK_DATA_DIR, `${candidate}.json`);
    try {
      const text = await readFile(filePath, 'utf8');
      const data = safeJsonParse(text);
      if (data && typeof data === 'object') {
        const record = { data, source: candidate, path: filePath };
        mockCache.set(upper, record);
        return record;
      }
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        console.warn(`[tiingo] Unable to read mock file ${filePath}:`, error.message || error);
      }
    }
  }

  const record = { data: null, source: null, path: null };
  mockCache.set(upper, record);
  return record;
}

const pickMockSection = (record, key) => {
  if (!record || !record.data || typeof record.data !== 'object') return null;
  const value = record.data[key];
  if (value === undefined) return null;
  return clone(value);
};

// --- API Helpers ---

const normaliseParams = (params = {}) => Object.entries(params)
  .filter(([, value]) => value !== undefined && value !== null && value !== '')
  .sort(([a], [b]) => (a > b ? 1 : a < b ? -1 : 0))
  .map(([key, value]) => `${key}=${value}`)
  .join('&');

const buildTiingoCacheKey = (path, params, token) => `${path}::${normaliseParams(params)}::${token || 'no-token'}`;

/**
 * A wrapper for making authenticated requests to the Tiingo API.
 * @param {string} path - The API endpoint path (e.g., '/tiingo/daily/aapl/prices').
 * @param {object} params - URL query parameters.
 * @param {string} token - The Tiingo API token.
 * @param {object} [options]
 * @param {number} [options.cacheTtl] Custom TTL for the cache entry in milliseconds.
 * @param {boolean} [options.forceRefresh] When true, bypasses the cache.
 * @returns {Promise<object|any[]>} The JSON response from the API.
 */
async function tiingo(path, params, token, options = {}) {
  const { cacheTtl, forceRefresh } = options || {};
  const url = new URL(path, API_BASE);
  url.searchParams.set('token', token);

  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }

  const cacheKey = buildTiingoCacheKey(path, params, token);
  if (forceRefresh) {
    tiingoResponseCache.delete(cacheKey);
  } else {
    const cached = tiingoResponseCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
  }

  const loader = async () => {
    const response = await fetch(url);
    const text = await response.text();
    let data = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        // Ignore JSON parsing errors for non-JSON responses.
      }
    }

    if (!response.ok) {
      const message = (data && (data.message || data.error || data.detail)) || text || response.statusText;
      throw new Error(`Tiingo ${response.status}: ${String(message).slice(0, 200)}`);
    }

    return data;
  };

  return tiingoResponseCache.resolve(cacheKey, loader, cacheTtl);
}

/**
 * Creates response metadata headers.
 * @returns {object} Headers with token information.
 */
function metaHeaders() {
  const chosenKey = TIINGO_TOKEN_ENV_KEYS.find((k) => typeof process.env?.[k] === 'string' && process.env[k].trim());
  const token = getTiingoToken();
  const preview = token ? `${token.slice(0, 4)}...${token.slice(-4)}` : '';
  return {
    'x-tiingo-chosen-key': chosenKey || '',
    'x-tiingo-token-preview': preview,
  };
}

/** Merge `meta` onto the body with a normalized `source` flag. */
function withMeta(body, source, extraMeta = {}) {
  return { ...body, meta: { ...(body.meta || {}), source, ...extraMeta } };
}

/**
 * Creates a standard success JSON response with an explicit data source.
 * @param {object} body - The response body.
 * @param {'live'|'eod-fallback'|'mock'} source - Where the data came from.
 * @param {object} [extraHeaders] - Extra headers to include.
 * @param {object} [extraMeta] - Extra meta fields to include.
 * @returns {Response}
 */
function ok(body, source = 'live', extraHeaders = {}, extraMeta = {}) {
  const extra = extraHeaders || {};
  const hasCacheControl = Object.keys(extra).some((key) => key.toLowerCase() === 'cache-control');
  const headers = {
    ...corsHeaders,
    ...metaHeaders(),
    'X-Tiingo-Source': source,
    ...(hasCacheControl ? {} : { 'cache-control': 'public, max-age=30, s-maxage=60' }),
    ...extra,
  };
  return Response.json(withMeta(body, source, extraMeta), { headers });
}

const mockResponse = (symbol, mode, warning, data, meta = {}) => {
  const headers = {
    ...corsHeaders,
    ...metaHeaders(),
    'X-Tiingo-Source': 'mock',
    'x-tiingo-fallback': 'mock',
    'cache-control': 'public, max-age=120, s-maxage=240',
  };
  const body = {
    symbol,
    data,
    warning: warning || 'Tiingo data unavailable. Showing sample data.',
  };
  return Response.json(withMeta(body, 'mock', { kind: mode, ...meta }), { headers });
};

// --- Data Loading Functions ---

/**
 * Fetches and formats End-of-Day (EOD) data.
 * @param {string} symbol - The stock symbol.
 * @param {number} limit - The number of data points to return.
 * @param {string} token - The Tiingo API token.
 * @returns {Promise<object[]>}
 */
export async function loadEod(symbol, limit, token) {
  const count = Math.max(Number(limit) || DEFAULT_EOD_POINTS, 1);
  const startDate = new Date(Date.now() - EOD_LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10);

  const rows = await tiingo(
    `/tiingo/daily/${encodeURIComponent(symbol)}/prices`,
    { startDate, resampleFreq: 'daily' },
    token,
    { cacheTtl: 10 * 60 * 1000 },
  );

  const list = Array.isArray(rows) ? rows.slice(-count) : [];

  return list.map((r, i) => ({
    symbol: symbol.toUpperCase(),
    date: r.date || r.timestamp || new Date().toISOString(),
    open: r.open ?? r.adjOpen ?? null,
    high: r.high ?? r.adjHigh ?? null,
    low: r.low ?? r.adjLow ?? null,
    close: r.close ?? r.adjClose ?? null,
    last: r.close ?? r.adjClose ?? null,
    price: r.close ?? r.adjClose ?? null,
    previousClose: i > 0 ? (list[i - 1].close ?? list[i - 1].adjClose ?? null) : (r.prevClose ?? r.adjPrevClose ?? null),
    volume: r.volume ?? r.adjVolume ?? null,
    exchange: r.exchange || '',
    currency: r.currency || r.currencyCode || 'USD',
  }));
}

/**
 * Fetches and formats Intraday data.
 * @param {string} symbol - The stock symbol.
 * @param {string} interval - The data interval (e.g., '5min', '1hour').
 * @param {number} limit - The number of data points to return.
 * @param {string} token - The Tiingo API token.
 * @returns {Promise<object[]>}
 */
export async function loadIntraday(symbol, interval, limit, token) {
  const freq = interval || '5min';
  const count = Math.max(Number(limit) || DEFAULT_INTRADAY_POINTS, 1);
  const stepMins = freq === '30min' ? 30 : freq === '1hour' ? 60 : 5;
  const lookbackMins = stepMins * (count + 12); // Add buffer
  const startDate = new Date(Date.now() - lookbackMins * 60 * 1000).toISOString();

  const rows = await tiingo(
    `/iex/${encodeURIComponent(symbol)}/prices`,
    { startDate, resampleFreq: freq },
    token,
    { cacheTtl: 30 * 1000 },
  );

  const list = Array.isArray(rows) ? rows.slice(-count) : [];

  return list.map((r, i) => ({
    symbol: symbol.toUpperCase(),
    date: r.date || r.timestamp || new Date().toISOString(),
    open: r.open ?? r.prevClose ?? null,
    high: r.high ?? null,
    low: r.low ?? null,
    close: r.close ?? r.last ?? null,
    last: r.last ?? r.close ?? null,
    price: r.last ?? r.close ?? null,
    previousClose: i > 0 ? (list[i - 1].close ?? null) : (r.prevClose ?? null),
    volume: r.volume ?? null,
    exchange: r.exchange || r.exchangeCode || '',
    currency: r.currency || 'USD',
  }));
}

/**
 * Fetches the latest IEX quote.
 * @param {string} symbol - The stock symbol.
 * @param {string} token - The Tiingo API token.
 * @returns {Promise<object|null>}
 */
export async function loadIntradayLatest(symbol, token) {
  const data = await tiingo('/iex', { tickers: symbol }, token, { cacheTtl: 10_000 });
  const row = Array.isArray(data) ? data.find((r) => (r.ticker || r.symbol || '').toUpperCase() === symbol.toUpperCase()) : null;

  if (!row) return null;

  const price = row.last ?? row.tngoLast ?? row.lastPrice ?? row.mid;
  const prev = row.prevClose ?? row.previousClose ?? row.close ?? row.openPrice;

  return {
    symbol: symbol.toUpperCase(),
    date: row.timestamp || row.lastSaleTimestamp || row.quoteTimestamp || new Date().toISOString(),
    exchange: row.exchange || row.exchangeCode || '',
    open: row.open ?? row.openPrice ?? prev ?? price,
    high: row.high ?? row.highPrice ?? price,
    low: row.low ?? row.lowPrice ?? price,
    close: price ?? prev ?? null,
    last: price ?? prev ?? null,
    price: price ?? prev ?? null,
    previousClose: prev ?? null,
    volume: row.volume ?? row.lastSize ?? row.tngoLastSize ?? null,
    currency: row.currency || row.currencyCode || 'USD',
  };
}

const toNumber = (value) => {
  const num = valuationUtils.toNumber ? valuationUtils.toNumber(value) : Number(value);
  if (Number.isFinite(num)) return num;
  return null;
};

const growthRate = (current, previous) => {
  const cur = toNumber(current);
  const prev = toNumber(previous);
  if (cur === null || prev === null || Math.abs(prev) < 1e-6) return null;
  return (cur - prev) / Math.abs(prev);
};

export async function loadFundamentals(symbol, token, limit = FUNDAMENTAL_LIMIT) {
  const count = Math.max(1, Math.min(Number(limit) || FUNDAMENTAL_LIMIT, 12));
  const rows = await tiingo(
    `/tiingo/fundamentals/${encodeURIComponent(symbol)}/daily`,
    { limit: count },
    token,
    { cacheTtl: 12 * 60 * 60 * 1000 },
  );
  const list = Array.isArray(rows) ? rows.filter((item) => item && typeof item === 'object') : [];
  list.sort((a, b) => new Date(a.reportDate || a.endDate || a.date || 0) - new Date(b.reportDate || b.endDate || b.date || 0));
  const history = list.slice(-count);
  const latest = history[history.length - 1] || null;
  const prev = history.length > 1 ? history[history.length - 2] : null;

  if (!latest) {
    return { symbol, latest: null, history: [], metrics: {} };
  }

  const shares = toNumber(latest.sharesBasic) || toNumber(latest.sharesOutstanding) || toNumber(latest.sharesDiluted) || null;
  const revenue = toNumber(latest.totalRevenue) ?? toNumber(latest.revenue);
  const netIncome = toNumber(latest.netIncome) ?? toNumber(latest.netIncomeApplicableToCommon);
  const freeCashFlow = toNumber(latest.freeCashFlow ?? latest.cashFlowOperatingActivities ?? latest.operatingCashFlow);
  const eps = toNumber(latest.eps) ?? toNumber(latest.epsDiluted) ?? (shares ? (netIncome ?? 0) / shares : null);
  const revenuePerShare = shares && revenue !== null ? revenue / shares : toNumber(latest.revenuePerShare);
  const fcfPerShare = shares && freeCashFlow !== null ? freeCashFlow / shares : toNumber(latest.freeCashFlowPerShare);
  const bookValuePerShare = toNumber(latest.bookValuePerShare) ?? (shares && toNumber(latest.totalEquity) !== null
    ? toNumber(latest.totalEquity) / shares
    : null);

  const revenueGrowth = growthRate(revenue, prev?.totalRevenue ?? prev?.revenue) ?? toNumber(latest.revenueGrowth);
  const epsGrowth = growthRate(eps, toNumber(prev?.eps) ?? toNumber(prev?.epsDiluted)) ?? toNumber(latest.epsGrowth);
  const fcfGrowth = growthRate(fcfPerShare, prev && shares
    ? (toNumber(prev.freeCashFlow ?? prev.cashFlowOperatingActivities ?? prev.operatingCashFlow) ?? null) /
      (toNumber(prev.sharesBasic) || toNumber(prev.sharesOutstanding) || toNumber(prev.sharesDiluted) || 1)
    : null) ?? toNumber(latest.cashFlowGrowth);

  return {
    symbol,
    latest,
    history,
    metrics: {
      sharesOutstanding: shares,
      revenue,
      netIncome,
      freeCashFlow,
      earningsPerShare: eps,
      revenuePerShare,
      freeCashFlowPerShare: fcfPerShare,
      bookValuePerShare,
      revenueGrowth,
      epsGrowth,
      fcfGrowth,
    },
  };
}

const mapNewsItem = (item) => ({
  id: String(item.id || item.articleID || `${item.publishedDate}-${item.url}` || Math.random()),
  headline: item.title || item.headline || item.description || '',
  summary: item.summary || item.description || '',
  url: item.url || item.sourceUrl || '',
  source: item.source || item.sourceName || item.provider || '',
  publishedAt: item.publishedDate || item.date || item.timestamp || new Date().toISOString(),
  sentiment: toNumber(item.sentiment) ?? null,
  tags: Array.isArray(item.tags) ? item.tags : [],
});

export async function loadCompanyNews(symbol, limit, token) {
  const count = Math.max(1, Math.min(Number(limit) || NEWS_LIMIT, 50));
  const rows = await tiingo(
    '/tiingo/news',
    { tickers: symbol, limit: count, sortBy: 'publishedDate', includeBody: false },
    token,
    { cacheTtl: 5 * 60 * 1000 },
  );
  const items = Array.isArray(rows) ? rows.map(mapNewsItem) : [];
  items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return items.slice(0, count);
}

export async function loadCompanyDocuments(symbol, limit, token) {
  const count = Math.max(1, Math.min(Number(limit) || DOCUMENT_LIMIT, 50));
  const rows = await tiingo(
    '/tiingo/news',
    { tickers: symbol, limit: count * 2, sortBy: 'publishedDate', tags: 'SEC', includeBody: false },
    token,
    { cacheTtl: 15 * 60 * 1000 },
  );
  const items = (Array.isArray(rows) ? rows : [])
    .map(mapNewsItem)
    .filter((item) => item.tags.some((tag) => /sec|filing|10-|earnings/i.test(tag)) || /10-|sec|filing/i.test(item.headline));
  if (!items.length) {
    return (Array.isArray(rows) ? rows : []).slice(0, count).map(mapNewsItem);
  }
  items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return items.slice(0, count).map((item) => ({
    ...item,
    documentType: item.tags.find((tag) => /10-|20-|8-/i.test(tag)) || 'Filing',
  }));
}

export async function loadCorporateActions(symbol, token) {
  const startDate = new Date(Date.now() - ACTION_LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10);
  const [dividendsRaw, splitsRaw] = await Promise.all([
    tiingo(`/tiingo/daily/${encodeURIComponent(symbol)}/dividends`, { startDate }, token, { cacheTtl: 24 * 60 * 60 * 1000 }).catch(() => []),
    tiingo(`/tiingo/daily/${encodeURIComponent(symbol)}/splits`, { startDate }, token, { cacheTtl: 24 * 60 * 60 * 1000 }).catch(() => []),
  ]);
  const dividends = Array.isArray(dividendsRaw)
    ? dividendsRaw.map((d) => ({
      exDate: d.exDate || d.payDate || d.recordDate || '',
      amount: toNumber(d.amount) ?? toNumber(d.cashAmount) ?? null,
      payDate: d.payDate || '',
      recordDate: d.recordDate || '',
      currency: d.currency || 'USD',
    }))
    : [];

  const splits = Array.isArray(splitsRaw)
    ? splitsRaw.map((s) => ({
      exDate: s.exDate || s.payDate || '',
      numerator: toNumber(s.numerator) ?? toNumber(s.ratio) ?? null,
      denominator: toNumber(s.denominator) ?? 1,
    }))
    : [];

  return { symbol, dividends, splits };
}

const normalizeStatementKey = (value) => {
  if (!value && value !== 0) return '';
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+(.)/g, (_, chr) => chr.toUpperCase())
    .replace(/^([a-z])/, (match) => match.toLowerCase());
};

const collectStatementValues = (entry) => {
  const target = {};
  const source = entry?.data || entry?.values || entry?.items || entry;

  const assignValue = (key, value) => {
    const normalizedKey = normalizeStatementKey(key);
    if (!normalizedKey) return;
    if (target[normalizedKey] !== undefined) return;
    const num = toNumber(value);
    target[normalizedKey] = Number.isFinite(num) ? num : null;
  };

  if (Array.isArray(source)) {
    for (const item of source) {
      assignValue(item?.tag || item?.label || item?.key || item?.field, item?.value ?? item?.amount ?? item?.val);
    }
  } else if (source && typeof source === 'object') {
    for (const [key, value] of Object.entries(source)) {
      if (['statementType', 'statement', 'type', 'period', 'reportDate', 'endDate', 'currency', 'date'].includes(key)) continue;
      assignValue(key, value);
    }
  }

  return target;
};

const mapStatementType = (type) => {
  const raw = (type || '').toString().toLowerCase();
  if (raw.includes('income')) return 'income';
  if (raw.includes('balance')) return 'balanceSheet';
  if (raw.includes('cash')) return 'cashFlow';
  if (raw.includes('financial') && raw.includes('position')) return 'balanceSheet';
  if (raw.includes('operations')) return 'income';
  return null;
};

const normalizeStatementEntry = (entry) => {
  const reportDate = entry?.reportDate || entry?.endDate || entry?.date || entry?.periodEnding || '';
  const period = entry?.period || entry?.periodType || entry?.fiscalPeriod || entry?.quarter || entry?.fiscalQuarter || '';
  const currency = entry?.currency || entry?.currencyCode || entry?.reportCurrency || 'USD';
  return {
    reportDate,
    period: period || 'FY',
    currency,
    ...collectStatementValues(entry),
  };
};

const mergeStatementSection = (sections, type, entry) => {
  const key = mapStatementType(type || entry?.statementType || entry?.statement || entry?.type);
  if (!key || !sections[key]) return;
  sections[key].push(normalizeStatementEntry(entry));
};

const finalizeStatements = (list = [], limit = FUNDAMENTAL_LIMIT) => {
  return list
    .filter((item) => item && item.reportDate)
    .sort((a, b) => new Date(b.reportDate) - new Date(a.reportDate))
    .slice(0, Math.max(1, limit));
};

export async function loadFinancialStatements(symbol, token, limit = FUNDAMENTAL_LIMIT) {
  const rows = await tiingo(
    `/tiingo/fundamentals/${encodeURIComponent(symbol)}/statements`,
    { format: 'json', limit: Math.max(4, Number(limit) || FUNDAMENTAL_LIMIT) },
    token,
    { cacheTtl: 6 * 60 * 60 * 1000 },
  );

  const sections = { income: [], balanceSheet: [], cashFlow: [] };
  const pushEntry = (type, entry) => mergeStatementSection(sections, type, entry);

  if (Array.isArray(rows)) {
    for (const entry of rows) {
      pushEntry(entry?.statementType, entry);
    }
  } else if (rows && typeof rows === 'object') {
    for (const [type, value] of Object.entries(rows)) {
      if (Array.isArray(value)) {
        for (const entry of value) pushEntry(type, entry);
      } else if (value && typeof value === 'object') {
        const maybeArray = value?.statementData || value?.data;
        if (Array.isArray(maybeArray)) {
          for (const entry of maybeArray) pushEntry(type, entry);
        } else {
          pushEntry(type, value);
        }
      }
    }
  }

  return {
    symbol: symbol.toUpperCase(),
    income: finalizeStatements(sections.income, limit),
    balanceSheet: finalizeStatements(sections.balanceSheet, limit),
    cashFlow: finalizeStatements(sections.cashFlow, limit),
  };
}

export async function loadCompanyOverview(symbol, token) {
  const data = await tiingo(`/tiingo/daily/${encodeURIComponent(symbol)}`, {}, token, { cacheTtl: 12 * 60 * 60 * 1000 });
  if (!data || typeof data !== 'object') return null;
  return {
    symbol: symbol.toUpperCase(),
    name: data.name || data.ticker || symbol.toUpperCase(),
    exchange: data.exchange || data.exchangeCode || '',
    sector: data.sector || data.assetType || '',
    industry: data.industry || '',
    description: data.description || data.summary || '',
    website: data.website || data.url || '',
    marketCap: toNumber(data.marketCap ?? data.marketcap) ?? null,
    sharesOutstanding: toNumber(data.sharesOutstanding ?? data.outstandingShares) ?? null,
    currency: data.currency || data.quoteCurrency || 'USD',
  };
}

export async function loadSecFilings(symbol, limit, token) {
  const documents = await loadCompanyDocuments(symbol, limit, token);
  return documents.map((doc) => ({
    ...doc,
    documentType: doc.documentType || 'Filing',
  }));
}

export async function loadValuation(symbol, token) {
  const [quote, fundamentals] = await Promise.all([
    loadIntradayLatest(symbol, token).catch(() => null),
    loadFundamentals(symbol, token).catch(() => null),
  ]);

  const metrics = fundamentals?.metrics || {};
  const price = quote?.price ?? metrics.price ?? fundamentals?.latest?.close ?? fundamentals?.latest?.adjClose ?? null;

  const valuation = buildValuationSnapshot({
    price,
    earningsPerShare: metrics.earningsPerShare,
    revenuePerShare: metrics.revenuePerShare,
    freeCashFlowPerShare: metrics.freeCashFlowPerShare,
    bookValuePerShare: metrics.bookValuePerShare,
    revenueGrowth: metrics.revenueGrowth,
    epsGrowth: metrics.epsGrowth,
    fcfGrowth: metrics.fcfGrowth,
  });

  const narrative = summarizeValuationNarrative(symbol, valuation);

  return {
    symbol,
    price,
    quote,
    fundamentals,
    valuation,
    narrative,
    generatedAt: new Date().toISOString(),
  };
}

// --- Mock handler ---

async function respondWithMock(kind, symbol, limit, warning, meta = {}) {
  const upper = (symbol || 'MOCK').toUpperCase();
  const record = await readMockData(upper);
  const mockSource = record.source
    ? record.source === upper
      ? 'file:symbol'
      : `file:${record.source.toLowerCase()}`
    : 'generated';
  const baseMeta = {
    ...meta,
    mockSource,
    mockFilePath: record.path || '',
  };

  const respond = (data, extraMeta = {}) => {
    console.warn(`[tiingo] ${upper}(${kind}): using MOCK data (${baseMeta.reason || 'unknown'}) [${baseMeta.mockSource}]`);
    return mockResponse(upper, kind, warning, data, { ...baseMeta, ...extraMeta });
  };

  const fromFile = (section) => {
    const value = pickMockSection(record, section);
    if (!value) return null;
    if (Array.isArray(value) && Number.isFinite(limit)) {
      return value.slice(0, Number(limit));
    }
    return value;
  };

  if (kind === 'news') {
    const news = fromFile('news');
    if (Array.isArray(news) && news.length) return respond(news);
    return respond(mockNews(upper, limit), { generator: 'procedural' });
  }

  if (kind === 'documents' || kind === 'filings') {
    const docs = fromFile('filings') || fromFile('documents');
    if (Array.isArray(docs) && docs.length) return respond(docs);
    return respond(mockFilings(upper, limit), { generator: 'procedural' });
  }

  if (kind === 'fundamentals') {
    const fundamentals = fromFile('fundamentals');
    if (fundamentals && fundamentals.latest) return respond(fundamentals);
    return respond(mockFundamentals(upper), { generator: 'procedural' });
  }

  if (kind === 'actions') {
    const actions = fromFile('actions');
    if (actions && (actions.dividends?.length || actions.splits?.length)) return respond(actions);
    return respond(mockActions(upper), { generator: 'procedural' });
  }

  if (kind === 'overview') {
    const overview = fromFile('overview');
    if (overview) return respond(overview);
    return respond(mockOverview(upper), { generator: 'procedural' });
  }

  if (kind === 'statements') {
    const statements = fromFile('statements');
    if (statements && (statements.income?.length || statements.balanceSheet?.length || statements.cashFlow?.length)) {
      return respond(statements);
    }
    return respond(mockStatements(upper), { generator: 'procedural' });
  }

  if (kind === 'valuation') {
    const valuation = fromFile('valuation');
    if (valuation) return respond(valuation);

    const fundamentals = fromFile('fundamentals') || mockFundamentals(upper);
    const quote = fromFile('quote') || mockQuote(upper);
    const metrics = fundamentals?.metrics || {};
    const price = quote?.price ?? metrics.price ?? fundamentals?.latest?.close ?? quote?.last ?? null;
    const valuationSnapshot = buildValuationSnapshot({
      price,
      earningsPerShare: metrics.earningsPerShare,
      revenuePerShare: metrics.revenuePerShare,
      freeCashFlowPerShare: metrics.freeCashFlowPerShare,
      bookValuePerShare: metrics.bookValuePerShare,
      revenueGrowth: metrics.revenueGrowth,
      epsGrowth: metrics.epsGrowth,
      fcfGrowth: metrics.fcfGrowth,
    });
    return respond({
      symbol: upper,
      price,
      quote,
      fundamentals,
      valuation: valuationSnapshot,
      narrative: summarizeValuationNarrative(upper, valuationSnapshot),
      generatedAt: new Date().toISOString(),
    }, { generator: 'procedural' });
  }

  if (kind === 'intraday_latest') {
    const quote = fromFile('quote');
    if (quote) return respond([quote]);
    const intraday = fromFile('intraday');
    if (Array.isArray(intraday) && intraday.length) return respond([intraday[intraday.length - 1]]);
    return respond([mockQuote(upper)], { generator: 'procedural' });
  }

  if (kind === 'intraday') {
    const intraday = fromFile('intraday');
    if (Array.isArray(intraday) && intraday.length) return respond(intraday.slice(-limit));
    return respond(mockSeries(upper, limit, 'intraday'), { generator: 'procedural' });
  }

  const eod = fromFile('eod');
  if (Array.isArray(eod) && eod.length) return respond(eod.slice(-limit));
  return respond(mockSeries(upper, limit, 'eod'), { generator: 'procedural' });
}

// --- Main Request Handler ---

/**
 * Handles incoming API requests, routes them, and provides fallbacks.
 * @param {Request} request - The incoming Fetch API request object.
 * @returns {Promise<Response>}
 */
async function handleTiingoRequest(request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') || 'eod';
  const symbol = (url.searchParams.get('symbol') || 'AAPL').toUpperCase();
  const interval = url.searchParams.get('interval') || '';
  const limit = Number(url.searchParams.get('limit')) || DEFAULT_EOD_POINTS;

  const token = getTiingoToken();
  if (!token) {
    console.warn(`[tiingo] ${symbol}(${kind}): no Tiingo token found. Checked keys: ${TIINGO_TOKEN_ENV_KEYS.join(', ')}`);
    return respondWithMock(kind, symbol, limit, 'Tiingo API key missing. Showing sample data.', {
      reason: 'missing_token',
      envKeysChecked: TIINGO_TOKEN_ENV_KEYS,
    });
  }

  try {
    if (kind === 'intraday_latest') {
      const quote = await loadIntradayLatest(symbol, token);
      if (quote) {
        return ok({ symbol, data: [quote] }, 'live', { 'cache-control': 'public, max-age=10, s-maxage=20' });
      }
      const eod = await loadEod(symbol, 1, token).catch(() => []);
      if (eod.length) {
        console.warn(`[tiingo] ${symbol}(${kind}): intraday latest unavailable -> EOD fallback`);
        return ok(
          { symbol, data: [eod[0]], warning: 'Intraday latest unavailable; showing EOD.' },
          'eod-fallback',
          { 'cache-control': 'public, max-age=600, s-maxage=1200' },
          { reason: 'intraday_latest_unavailable' },
        );
      }
      return respondWithMock(kind, symbol, limit, 'Intraday latest unavailable. Showing sample data.', {
        reason: 'intraday_latest_unavailable_and_no_eod',
      });
    }

    if (kind === 'intraday') {
      const rows = await loadIntraday(symbol, interval, limit, token);
      if (rows.length) {
        return ok({ symbol, data: rows }, 'live', { 'cache-control': 'public, max-age=30, s-maxage=60' });
      }
      const eod = await loadEod(symbol, limit, token).catch(() => []);
      if (eod.length) {
        console.warn(`[tiingo] ${symbol}(${kind}): intraday unavailable -> EOD fallback`);
        return ok(
          { symbol, data: eod, warning: 'Intraday unavailable; showing EOD.' },
          'eod-fallback',
          { 'cache-control': 'public, max-age=600, s-maxage=1200' },
          { reason: 'intraday_unavailable' },
        );
      }
      return respondWithMock(kind, symbol, limit, 'Intraday unavailable. Showing sample data.', {
        reason: 'intraday_unavailable_and_no_eod',
      });
    }

    if (kind === 'news') {
      const news = await loadCompanyNews(symbol, limit, token);
      if (news.length) {
        return ok({ symbol, data: news }, 'live', { 'cache-control': 'public, max-age=300, s-maxage=600' });
      }
      return respondWithMock(kind, symbol, limit, 'Company news unavailable. Showing sample data.', { reason: 'news_unavailable' });
    }

    if (kind === 'documents') {
      const docs = await loadCompanyDocuments(symbol, limit, token);
      if (docs.length) {
        return ok({ symbol, data: docs }, 'live', { 'cache-control': 'public, max-age=900, s-maxage=1800' });
      }
      return respondWithMock(kind, symbol, limit, 'Company filings unavailable. Showing sample data.', { reason: 'documents_unavailable' });
    }

    if (kind === 'filings') {
      const filings = await loadSecFilings(symbol, limit, token);
      if (filings.length) {
        return ok({ symbol, data: filings }, 'live', { 'cache-control': 'public, max-age=900, s-maxage=1800' });
      }
      return respondWithMock(kind, symbol, limit, 'SEC filings unavailable. Showing sample data.', { reason: 'filings_unavailable' });
    }

    if (kind === 'fundamentals') {
      const fundamentals = await loadFundamentals(symbol, token, limit);
      if (fundamentals.latest) {
        return ok({ symbol, data: fundamentals }, 'live', { 'cache-control': 'public, max-age=43200, s-maxage=86400' });
      }
      return respondWithMock(kind, symbol, limit, 'Fundamentals unavailable. Showing sample data.', { reason: 'fundamentals_unavailable' });
    }

    if (kind === 'actions') {
      const actions = await loadCorporateActions(symbol, token);
      if ((actions.dividends && actions.dividends.length) || (actions.splits && actions.splits.length)) {
        return ok({ symbol, data: actions }, 'live', { 'cache-control': 'public, max-age=86400, s-maxage=172800' });
      }
      return respondWithMock(kind, symbol, limit, 'Corporate actions unavailable. Showing sample data.', { reason: 'actions_unavailable' });
    }

    if (kind === 'overview') {
      const overview = await loadCompanyOverview(symbol, token);
      if (overview) {
        return ok({ symbol, data: overview }, 'live', { 'cache-control': 'public, max-age=43200, s-maxage=86400' });
      }
      return respondWithMock(kind, symbol, limit, 'Company overview unavailable. Showing sample data.', { reason: 'overview_unavailable' });
    }

    if (kind === 'statements') {
      const statements = await loadFinancialStatements(symbol, token, limit);
      if (statements.income.length || statements.balanceSheet.length || statements.cashFlow.length) {
        return ok({ symbol, data: statements }, 'live', { 'cache-control': 'public, max-age=21600, s-maxage=43200' });
      }
      return respondWithMock(kind, symbol, limit, 'Financial statements unavailable. Showing sample data.', { reason: 'statements_unavailable' });
    }

    if (kind === 'valuation') {
      const valuation = await loadValuation(symbol, token);
      if (valuation) {
        return ok({ symbol, data: valuation }, 'live', { 'cache-control': 'public, max-age=900, s-maxage=1800' });
      }
      return respondWithMock(kind, symbol, limit, 'Valuation snapshot unavailable. Showing sample data.', { reason: 'valuation_unavailable' });
    }

    const rows = await loadEod(symbol, limit, token);
    if (rows.length) {
      return ok({ symbol, data: rows }, 'live', { 'cache-control': 'public, max-age=600, s-maxage=1200' });
    }
    return respondWithMock(kind, symbol, limit, 'EOD unavailable. Showing sample data.', { reason: 'eod_unavailable' });
  } catch (err) {
    console.error(`Tiingo request failed for ${symbol}:`, err);
    return respondWithMock(kind, symbol, limit, 'Tiingo request failed. Showing sample data.', {
      reason: 'exception',
      message: err?.message?.slice(0, 200) || String(err),
    });
  }
}

export default handleTiingoRequest;

// --- Netlify Function Entrypoint ---

/**
 * Netlify serverless function handler.
 * Bridges Netlify's event object to a standard Fetch Request object.
 * @param {object} event - The Netlify event object.
 * @returns {Promise<{statusCode: number, headers: object, body: string}>}
 */
export const handler = async (event) => {
  const rawQuery = event?.rawQuery ?? '';
  const path = event?.path || '/';
  const host = event?.headers?.host || 'example.org';
  const url = event?.rawUrl || `https://${host}${path}${rawQuery ? `?${rawQuery}` : ''}`;
  const method = event?.httpMethod || 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : event?.body;

  const request = new Request(url, {
    method,
    headers: event?.headers || {},
    body,
  });

  const response = await handleTiingoRequest(request);

  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    statusCode: response.status,
    headers,
    body: await response.text(),
  };
};

export const __private = {
  mockSeries,
  mockQuote,
  mockNews,
  mockFundamentals,
  mockActions,
  mockDocuments,
  mockOverview,
  mockStatements,
  mockFilings,
  readMockData,
  pickMockSection,
  respondWithMock,
};
