const corsHeaders = { 'access-control-allow-origin': process.env.ALLOWED_ORIGIN || '*' };
const API_BASE = 'https://api.tiingo.com/';

function generateMockData(points = 30, symbol = 'MOCK') {
  const today = new Date();
  return Array.from({ length: points }).map((_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const open = 150 + Math.sin(i / 3) * 5 + (i % 7) - 3;
    const close = open + (Math.random() - 0.5) * 4;
    const high = Math.max(open, close) + Math.random() * 2;
    const low = Math.min(open, close) - Math.random() * 2;
    const closeVal = +close.toFixed(2);
    return {
      date: d.toISOString(),
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: closeVal,
      volume: Math.floor(1e7 + Math.random() * 5e6),
      symbol,
      currency: 'USD',
      last: closeVal,
      price: closeVal,
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

const summarizeError = (err) => {
  if (!err) return '';
  if (err instanceof Error) return err.message || err.toString();
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch (_) {
    return String(err);
  }
};

const appendDetail = (message, err) => {
  const detail = summarizeError(err);
  if (!message) return detail;
  return detail ? `${message} (${detail})` : message;
};

const normalizeQuote = (row, fallbackSymbol) => {
  const symbol = (row?.ticker || row?.symbol || fallbackSymbol || '').toUpperCase();
  const close = toNumber(
    firstNonNull(row?.close, row?.last, row?.lastPrice, row?.tngoLast, row?.mid, row?.adjClose)
  );
  const open = toNumber(
    firstNonNull(row?.open, row?.prevClose, row?.openPrice, row?.adjOpen, close)
  );
  const high = toNumber(firstNonNull(row?.high, row?.highPrice, row?.adjHigh, close));
  const low = toNumber(firstNonNull(row?.low, row?.lowPrice, row?.adjLow, close));
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
  const close = toNumber(firstNonNull(row?.close, row?.adjClose, row?.last, row?.lastPrice));
  const open = toNumber(firstNonNull(row?.open, row?.adjOpen, row?.openPrice, close));
  const high = toNumber(firstNonNull(row?.high, row?.adjHigh, close));
  const low = toNumber(firstNonNull(row?.low, row?.adjLow, close));
  return {
    symbol: (row?.symbol || row?.ticker || symbol || '').toUpperCase(),
    date: row?.date || row?.timestamp || new Date().toISOString(),
    open,
    high,
    low,
    close,
    last: close,
    price: close,
    volume: toNumber(row?.volume),
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

async function getWithFallback(primaryFn, fallbackFn, { fallbackWarning } = {}) {
  let usedFallback = false;
  let primaryError = null;

  try {
    const result = await primaryFn();
    if (Array.isArray(result) && result.length) {
      return { data: result, warning: null };
    }
    if (!fallbackFn) {
      return { data: Array.isArray(result) ? result : [], warning: fallbackWarning || null };
    }
    usedFallback = true;
  } catch (err) {
    primaryError = err;
    if (!fallbackFn) throw err;
    usedFallback = true;
  }

  if (!fallbackFn) {
    return { data: [], warning: fallbackWarning || summarizeError(primaryError) };
  }

  try {
    const fallbackResult = await fallbackFn();
    if (Array.isArray(fallbackResult) && fallbackResult.length) {
      const warning = usedFallback
        ? appendDetail(fallbackWarning || 'Tiingo primary endpoint unavailable.', primaryError)
        : null;
      return { data: fallbackResult, warning };
    }
    throw new Error('Fallback returned no data');
  } catch (fallbackErr) {
    const reason = appendDetail(
      fallbackWarning || 'Tiingo primary endpoint failed.',
      primaryError
    );
    throw new Error(appendDetail(reason, fallbackErr));
  }
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
      {
        symbol: symbolParam,
        data: generateMockData(limit || 30, symbols[0] || 'MOCK'),
        ...extra,
      },
      { headers: corsHeaders }
    );

  const respond = (body, status = 200) => Response.json(body, { headers: corsHeaders, status });

  const token = process.env.TIINGO_KEY || process.env.REACT_APP_TIINGO_KEY;
  if (!token) {
    return sendMock({ warning: 'Tiingo API key missing. Showing mock pricing data.' });
  }

  try {
    let result = { data: [], warning: null };
    if (kind === 'intraday_latest') {
      result = await getWithFallback(
        () => loadIntradayLatest(symbols, token),
        () => loadEodLatest(symbols, token),
        {
          fallbackWarning:
            'Tiingo intraday quotes unavailable. Showing latest daily close instead.',
        }
      );
    } else if (kind === 'eod_latest') {
      const data = await loadEodLatest(symbols, token);
      result = { data, warning: null };
    } else if (kind === 'intraday') {
      const symbol = symbols[0] || 'AAPL';
      result = await getWithFallback(
        () => loadIntraday(symbol, interval, limit, token),
        () => loadEod(symbol, limit, token),
        {
          fallbackWarning:
            'Tiingo intraday candles unavailable. Showing end-of-day history instead.',
        }
      );
    } else {
      const symbol = symbols[0] || 'AAPL';
      const data = await loadEod(symbol, limit, token);
      result = { data, warning: null };
    }

    const { data, warning } = result;

    if (!Array.isArray(data) || data.length === 0) {
      return respond({
        symbol: symbolParam,
        data: [],
        warning: appendDetail(
          'Tiingo returned no data for the requested symbol.',
          warning || null
        ),
        error: 'tiingo_empty',
      });
    }

    const body = { symbol: symbolParam, data };
    if (warning) body.warning = warning;
    return respond(body);
  } catch (err) {
    console.error('Tiingo fetch failed:', err);
    return respond(
      {
        symbol: symbolParam,
        error: 'tiingo_failed',
        detail: summarizeError(err),
      },
      502
    );
  }
};
