const corsHeaders = { 'access-control-allow-origin': process.env.ALLOWED_ORIGIN || '*' };
const API_BASE = 'https://api.tiingo.com/';

function generateMockData(points = 30) {
  const today = new Date();
  return Array.from({ length: points }).map((_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const open = 150 + Math.sin(i / 3) * 5 + (i % 7) - 3;
    const close = open + (Math.random() - 0.5) * 4;
    const high = Math.max(open, close) + Math.random() * 2;
    const low = Math.min(open, close) - Math.random() * 2;
    return {
      date: d.toISOString(),
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
      volume: Math.floor(1e7 + Math.random() * 5e6),
      symbol: 'MOCK',
      currency: 'USD',
      last: +close.toFixed(2),
      price: +close.toFixed(2),
    };
  });
}

const toNumber = (value) => {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const firstNonNull = (...values) => {
  for (const v of values) {
    if (v != null) return v;
  }
  return null;
};

const formatDate = (date) => date.toISOString().split('T')[0];

const minutesAgo = (mins) => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - mins);
  return d;
};

async function fetchTiingo(path, params, token) {
  const url = new URL(path, API_BASE);
  url.searchParams.set('token', token);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, value);
  }
  const resp = await fetch(url);
  const text = await resp.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      if (!resp.ok) {
        throw new Error(`Tiingo ${resp.status}: ${text.slice(0, 200)}`);
      }
      throw err;
    }
  }
  if (!resp.ok) {
    const detail =
      data && typeof data === 'object'
        ? data.message || data.error || data.detail || JSON.stringify(data).slice(0, 200)
        : text.slice(0, 200) || resp.statusText;
    throw new Error(`Tiingo ${resp.status}: ${detail}`);
  }
  return data;
}

const normalizeQuote = (row, fallbackSymbol) => {
  const symbol = (row?.ticker || row?.symbol || fallbackSymbol || '').toUpperCase();
  const close = toNumber(
    firstNonNull(row?.close, row?.last, row?.lastPrice, row?.tngoLast, row?.mid)
  );
  const open = toNumber(firstNonNull(row?.open, row?.prevClose, row?.openPrice));
  const high = toNumber(firstNonNull(row?.high, row?.highPrice, close));
  const low = toNumber(firstNonNull(row?.low, row?.lowPrice, close));
  const volume = toNumber(firstNonNull(row?.volume, row?.lastSize, row?.tngoLastSize));
  const timestamp =
    row?.timestamp ||
    row?.lastSaleTimestamp ||
    row?.quoteTimestamp ||
    row?.tngoLastTime ||
    row?.date ||
    new Date().toISOString();
  return {
    symbol,
    date: timestamp,
    exchange: row?.exchange || row?.exchangeCode || '',
    open,
    high,
    low,
    close,
    last: close,
    price: close,
    volume,
    currency: 'USD',
  };
};

const normalizeCandle = (row, symbol) => ({
  symbol: (row?.symbol || row?.ticker || symbol || '').toUpperCase(),
  date: row?.date || row?.timestamp || new Date().toISOString(),
  open: toNumber(row?.open),
  high: toNumber(row?.high),
  low: toNumber(row?.low),
  close: toNumber(row?.close),
  last: toNumber(row?.close),
  price: toNumber(row?.close),
  volume: toNumber(row?.volume),
  exchange: row?.exchange || row?.exchangeCode || '',
  currency: 'USD',
});

const minutesForInterval = (interval) => {
  if (interval === '30min') return 30;
  if (interval === '1hour') return 60;
  return 5;
};

async function loadIntradayLatest(symbols, token) {
  if (!symbols.length) return [];
  const data = await fetchTiingo('/iex', { tickers: symbols.join(',') }, token);
  const rows = Array.isArray(data) ? data : [];
  return rows.map((row) => normalizeQuote(row, row?.ticker)).filter((row) => row.symbol);
}

async function loadEodLatest(symbols, token) {
  if (!symbols.length) return [];
  const start = formatDate(minutesAgo(60 * 24 * 14)); // look back ~2 weeks for the latest close
  const results = await Promise.all(
    symbols.map(async (sym) => {
      const path = `/tiingo/daily/${encodeURIComponent(sym)}/prices`;
      const data = await fetchTiingo(path, { startDate: start, resampleFreq: 'daily' }, token);
      const rows = Array.isArray(data) ? data : [];
      const latest = rows[rows.length - 1];
      return latest ? normalizeCandle(latest, sym) : null;
    })
  );
  return results.filter(Boolean);
}

async function loadIntraday(symbol, interval, limit, token) {
  const freq = interval || '5min';
  const step = minutesForInterval(freq);
  const lookback = step * Math.max(Number(limit) || 1, 1) + step * 6; // add a little padding
  const startDate = minutesAgo(lookback).toISOString();
  const path = `/iex/${encodeURIComponent(symbol)}/prices`;
  const data = await fetchTiingo(path, { startDate, resampleFreq: freq }, token);
  const rows = Array.isArray(data) ? data : [];
  const count = Math.max(Number(limit) || 30, 1);
  return rows.slice(-count).map((row) => normalizeCandle(row, symbol));
}

async function loadEod(symbol, limit, token) {
  const count = Math.max(Number(limit) || 30, 1);
  const daysBack = Math.max(Math.ceil(count * 1.7), 60);
  const startDate = formatDate(minutesAgo(daysBack * 24 * 60));
  const path = `/tiingo/daily/${encodeURIComponent(symbol)}/prices`;
  const data = await fetchTiingo(path, { startDate, resampleFreq: 'daily' }, token);
  const rows = Array.isArray(data) ? data : [];
  return rows.slice(-count).map((row) => normalizeCandle(row, symbol));
}

export default async (request) => {
  const url = new URL(request.url);
  const symbolParam = url.searchParams.get('symbol') || 'AAPL';
  const kind = url.searchParams.get('kind') || 'eod';
  const interval = url.searchParams.get('interval') || '';
  const limit = Number(url.searchParams.get('limit')) || 30;

  const symbols = symbolParam
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const sendMock = (extra = {}) =>
    Response.json(
      { symbol: symbolParam, data: generateMockData(limit || 30), ...extra },
      { headers: corsHeaders }
    );

  const token = process.env.TIINGO_KEY || process.env.REACT_APP_TIINGO_KEY;
  if (!token) {
    return sendMock();
  }

  try {
    let data = [];
    if (kind === 'intraday_latest') {
      data = await loadIntradayLatest(symbols, token);
    } else if (kind === 'eod_latest') {
      data = await loadEodLatest(symbols, token);
    } else if (kind === 'intraday') {
      const symbol = symbols[0] || 'AAPL';
      data = await loadIntraday(symbol, interval, limit, token);
    } else {
      const symbol = symbols[0] || 'AAPL';
      data = await loadEod(symbol, limit, token);
    }

    if (!Array.isArray(data) || data.length === 0) {
      return sendMock({ warning: 'tiingo unavailable' });
    }

    return Response.json({ symbol: symbolParam, data }, { headers: corsHeaders });
  } catch (err) {
    return Response.json(
      {
        symbol: symbolParam,
        data: generateMockData(limit || 30),
        error: 'tiingo failed',
        detail: String(err),
      },
      { headers: corsHeaders, status: 500 }
    );
  }
};
