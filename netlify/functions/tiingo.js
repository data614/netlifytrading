const corsHeaders = { 'access-control-allow-origin': process.env.ALLOWED_ORIGIN || '*' };
const API_BASE = 'https://api.tiingo.com/';

const DAY_MS = 24 * 60 * 60 * 1000;
const INTRADAY_STEP_MS = 5 * 60 * 1000;

function hashCode(input) {
  const str = (input || 'MOCK').toUpperCase();
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 33 + str.charCodeAt(i)) >>> 0;
  }
  return hash || 1;
}

function createRng(seed) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function roundPrice(value) {
  return Number(Math.max(value, 0.01).toFixed(2));
}

function generateMockSeries(symbol, points = 30, mode = 'eod') {
  const key = (symbol || 'MOCK').toUpperCase();
  const rng = createRng(hashCode(key));
  const base = 40 + rng() * 160;
  const stepMs = mode === 'intraday' ? INTRADAY_STEP_MS : DAY_MS;
  const now = Date.now();
  const out = [];

  for (let i = points - 1; i >= 0; i -= 1) {
    const ts = new Date(now - i * stepMs);
    const drift = (rng() - 0.5) * 8;
    const open = base + drift;
    const close = open + (rng() - 0.5) * 6;
    const high = Math.max(open, close) + rng() * 3;
    const low = Math.min(open, close) - rng() * 3;
    const price = roundPrice(close);

    out.push({
      symbol: key,
      date: ts.toISOString(),
      open: roundPrice(open),
      high: roundPrice(high),
      low: roundPrice(low),
      close: price,
      last: price,
      price,
      volume: Math.floor(5e5 + rng() * 7e6),
      exchange: '',
      currency: 'USD',
    });
  }

  return out;
}

function generateMockQuote(symbol) {
  const series = generateMockSeries(symbol, 1, 'intraday');
  return series[0];
}

function generateMockQuotes(symbols) {
  const list = symbols.length ? symbols : ['MOCK'];
  return list.map((sym) => generateMockQuote(sym));
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

const normalizeCandle = (row, symbol) => {
  const close = toNumber(firstNonNull(row?.close, row?.last, row?.adjClose, row?.tngoLast));
  const open = toNumber(firstNonNull(row?.open, row?.adjOpen, row?.prevClose, close));
  const high = toNumber(firstNonNull(row?.high, row?.adjHigh, row?.highPrice, close));
  const low = toNumber(firstNonNull(row?.low, row?.adjLow, row?.lowPrice, close));
  const volume = toNumber(firstNonNull(row?.volume, row?.adjVolume, row?.sharesOutstanding, row?.volumeNotional));

  return {
    symbol: (row?.symbol || row?.ticker || symbol || '').toUpperCase(),
    date: row?.date || row?.timestamp || new Date().toISOString(),
    open,
    high,
    low,
    close,
    last: close,
    price: close,
    volume,
    exchange: row?.exchange || row?.exchangeCode || '',
    currency: 'USD',
  };
};

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

  const isQuoteRequest = kind === 'intraday_latest' || kind === 'eod_latest';
  const seriesMode = kind === 'intraday' ? 'intraday' : 'eod';

  const sendMock = (mode, extra = {}, init = {}) => {
    const { seriesMode: overrideSeriesMode, ...rest } = extra;
    const list = symbols.length ? symbols : ['MOCK'];
    let data = [];

    if (mode === 'quotes') {
      data = generateMockQuotes(list);
    } else {
      const target = list[0] || 'MOCK';
      const mockSeriesMode = overrideSeriesMode || seriesMode;
      data = generateMockSeries(target, limit || 30, mockSeriesMode);
    }

    const body = { symbol: symbolParam, data, ...rest };
    const responseInit = { ...init, headers: { ...corsHeaders, ...(init.headers || {}) } };
    return Response.json(body, responseInit);
  };

  const token = process.env.TIINGO_KEY || process.env.REACT_APP_TIINGO_KEY;
  if (!token) {
    return sendMock(isQuoteRequest ? 'quotes' : 'series', {
      warning: 'Tiingo API key missing. Showing sample data.',
      seriesMode,
    });
  }

  try {
    let data = [];
    let warning = '';
    if (kind === 'intraday_latest') {
      const quotes = await loadIntradayLatest(symbols, token);
      const map = new Map();
      quotes.forEach((row) => {
        const key = (row?.symbol || '').toUpperCase();
        if (key && !map.has(key)) {
          map.set(key, row);
        }
      });

      let usedEodFallback = false;
      let usedMockFallback = false;

      const missing = symbols.filter((sym) => !map.has(sym));
      if (missing.length) {
        const fallback = await loadEodLatest(missing, token);
        fallback.forEach((row) => {
          const key = (row?.symbol || '').toUpperCase();
          if (key && !map.has(key)) {
            map.set(key, row);
            usedEodFallback = true;
          }
        });
      }

      const stillMissing = symbols.filter((sym) => !map.has(sym));
      if (stillMissing.length) {
        const mocks = generateMockQuotes(stillMissing);
        mocks.forEach((mock, idx) => {
          const key = stillMissing[idx];
          map.set(key, mock);
        });
        usedMockFallback = true;
      }

      data = symbols.map((sym) => map.get(sym)).filter(Boolean);

      if (usedMockFallback) {
        warning =
          'Some symbols are unavailable from Tiingo in real time; displaying sample data for those tickers.';
      } else if (usedEodFallback) {
        warning =
          'Some symbols are using end-of-day fallback prices because real-time quotes were unavailable.';
      }
    } else if (kind === 'eod_latest') {
      data = await loadEodLatest(symbols, token);
    } else if (kind === 'intraday') {
      const symbol = symbols[0] || 'AAPL';
      data = await loadIntraday(symbol, interval, limit, token);
      if (!data.length) {
        const fallback = await loadEod(symbol, limit, token);
        if (fallback.length) {
          data = fallback;
          warning = 'Showing end-of-day prices because intraday data was unavailable.';
        }
      }
    } else {
      const symbol = symbols[0] || 'AAPL';
      data = await loadEod(symbol, limit, token);
    }

    if (!Array.isArray(data) || data.length === 0) {
      return sendMock(isQuoteRequest ? 'quotes' : 'series', {
        warning: 'Tiingo data unavailable. Showing sample data.',
        seriesMode,
      });
    }

    const body = { symbol: symbolParam, data };
    if (warning) body.warning = warning;

    return Response.json(body, { headers: corsHeaders });
  } catch (err) {
    return sendMock(
      isQuoteRequest ? 'quotes' : 'series',
      {
        warning: 'Tiingo request failed. Showing sample data.',
        error: 'tiingo failed',
        detail: String(err),
        seriesMode,
      },
      { status: 500 }
    );
  }
};
