import { getTiingoToken, getTiingoTokenDetail, TIINGO_TOKEN_ENV_KEYS } from './lib/env.js';

// --- Configuration & Constants ---

const API_BASE = 'https://api.tiingo.com';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const corsHeaders = { 'access-control-allow-origin': ALLOWED_ORIGIN };

const DAY_MS = 24 * 60 * 60 * 1000;
const INTRADAY_MS = 5 * 60 * 1000;
const EOD_LOOKBACK_DAYS = 400;
const DEFAULT_EOD_POINTS = 30;
const DEFAULT_INTRADAY_POINTS = 150;

// --- Mock Data Generators ---

/**
 * Creates a pseudo-random number generator from a seed string.
 * @param {string} s - The seed string.
 * @returns {() => number} A function that returns a random number between 0 and 1.
 */
function seed(s) {
  let v = 1;
  for (let i = 0; i < s.length; i++) {
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

  for (let i = points - 1; i >= 0; i--) {
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

// --- API Helpers ---

/**
 * A wrapper for making authenticated requests to the Tiingo API.
 * @param {string} path - The API endpoint path (e.g., '/tiingo/daily/aapl/prices').
 * @param {object} params - URL query parameters.
 * @param {string} token - The Tiingo API token.
 * @returns {Promise<object|any[]>} The JSON response from the API.
 */
async function tiingo(path, params, token) {
  const url = new URL(path, API_BASE);
  url.searchParams.set('token', token);

  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }

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

/**
 * Creates a standard success JSON response.
 * @param {object} body - The response body.
 * @returns {Response}
 */
function ok(body) {
  return Response.json(body, { headers: { ...corsHeaders, ...metaHeaders() } });
}

/**
 * Creates a mock data JSON response with a warning.
 * @param {object} body - Information for generating the mock data.
 * @returns {Response}
 */
function mock(body) {
  const data = body.mode === 'quotes'
    ? [mockQuote(body.symbol)]
    : mockSeries(body.symbol, body.limit, body.mode === 'intraday' ? 'intraday' : 'eod');

  const responseBody = {
    symbol: body.symbol || 'MOCK',
    data,
    warning: body.warning || 'Tiingo data unavailable. Showing sample data.',
  };

  const headers = {
    ...corsHeaders,
    ...metaHeaders(),
    'x-tiingo-fallback': 'mock',
  };

  return Response.json(responseBody, { headers });
}

// --- Data Loading Functions ---

/**
 * Fetches and formats End-of-Day (EOD) data.
 * @param {string} symbol - The stock symbol.
 * @param {number} limit - The number of data points to return.
 * @param {string} token - The Tiingo API token.
 * @returns {Promise<object[]>}
 */
async function loadEod(symbol, limit, token) {
  const count = Math.max(Number(limit) || DEFAULT_EOD_POINTS, 1);
  const startDate = new Date(Date.now() - EOD_LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10);

  const rows = await tiingo(
    `/tiingo/daily/${encodeURIComponent(symbol)}/prices`,
    { startDate, resampleFreq: 'daily' },
    token
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
async function loadIntraday(symbol, interval, limit, token) {
  const freq = interval || '5min';
  const count = Math.max(Number(limit) || DEFAULT_INTRADAY_POINTS, 1);
  const stepMins = freq === '30min' ? 30 : freq === '1hour' ? 60 : 5;
  const lookbackMins = stepMins * (count + 12); // Add buffer
  const startDate = new Date(Date.now() - lookbackMins * 60 * 1000).toISOString();

  const rows = await tiingo(
    `/iex/${encodeURIComponent(symbol)}/prices`,
    { startDate, resampleFreq: freq },
    token
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
async function loadIntradayLatest(symbol, token) {
  const data = await tiingo('/iex', { tickers: symbol }, token);
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
    return mock({ symbol, mode: kind, limit, warning: 'Tiingo API key missing. Showing sample data.' });
  }

  try {
    if (kind === 'intraday_latest') {
      const quote = await loadIntradayLatest(symbol, token);
      if (quote) {
        return ok({ symbol, data: [quote] });
      }
      // Fallback: try to get latest EOD if latest quote fails
      const eod = await loadEod(symbol, 1, token).catch(() => []);
      if (eod.length) {
        return ok({ symbol, data: [eod[0]], warning: 'Intraday latest unavailable; showing EOD.' });
      }
      return mock({ symbol, mode: 'quotes', warning: 'Real-time quotes unavailable. Showing sample data.' });
    }

    if (kind === 'intraday') {
      const rows = await loadIntraday(symbol, interval, limit, token);
      if (rows.length) {
        return ok({ symbol, data: rows });
      }
      // Fallback: try to get EOD if intraday fails
      const eod = await loadEod(symbol, limit, token).catch(() => []);
      if (eod.length) {
        return ok({ symbol, data: eod, warning: 'Intraday unavailable; showing EOD.' });
      }
      return mock({ symbol, mode: 'intraday', limit, warning: 'Intraday unavailable. Showing sample data.' });
    }

    // Default to EOD
    const rows = await loadEod(symbol, limit, token);
    if (rows.length) {
      return ok({ symbol, data: rows });
    }
    return mock({ symbol, mode: 'eod', limit, warning: 'EOD unavailable. Showing sample data.' });

  } catch (err) {
    console.error(`Tiingo request failed for ${symbol}:`, err);
    return mock({ symbol, mode: kind, limit, warning: 'Tiingo request failed. Showing sample data.' });
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

  // Convert Fetch Response headers to a plain object for Netlify
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