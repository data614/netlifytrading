// netlify/functions/tiingo.js
const corsHeaders = { 'access-control-allow-origin': process.env.ALLOWED_ORIGIN || '*' };
const API_BASE = 'https://api.tiingo.com/';

const DAY_MS = 24 * 60 * 60 * 1000;
const INTRADAY_STEP_MS = 5 * 60 * 1000;

const MIC_ALIASES = {
  NASDAQ: 'XNAS', NAS: 'XNAS', NASD: 'XNAS',
  NYSE: 'XNYS', ARCA: 'ARCX', BATS: 'BATS', IEX: 'IEXG',
  AMEX: 'XASE', ASE: 'XASE',
  ASX: 'XASX', LSE: 'XLON', LON: 'XLON', LONDON: 'XLON',
  HKEX: 'XHKG', HK: 'XHKG', HKG: 'XHKG',
  TSE: 'XTSE', TSX: 'XTSE', TSXV: 'XTSX', VENTURE: 'XTSX',
  JPX: 'XTKS', TYO: 'XTKS',
  SGX: 'XSES', SI: 'XSES',
  NSE: 'XNSE', BSE: 'XBOM',
  FRA: 'XFRA', FWB: 'XFRA', XETRA: 'XETR', ETR: 'XETR',
  SWX: 'XSWX', SIX: 'XSWX',
  AMS: 'XAMS', BRU: 'XBRU', BRUX: 'XBRU',
  MAD: 'XMAD', PAR: 'XPAR', MIL: 'XMIL',
  BMV: 'XMEX', MEX: 'XMEX', MEXI: 'XMEX',
  SAO: 'BVMF', B3: 'BVMF',
  JSE: 'XJSE',
  KRX: 'XKRX', KRXKOSPI: 'XKRX', KOSPI: 'XKRX', KOSDAQ: 'XKOS',
  SHG: 'XSHG', SHSZ: 'XSHG', SHE: 'XSHE', SZSE: 'XSHE',
  NZX: 'XNZE',
  OSE: 'XOSL', OSL: 'XOSL',
  CSE: 'XCSE', CPHEX: 'XCSE',
  STO: 'XSTO', HEL: 'XHEL',
  IDX: 'XIDX', JKSE: 'XIDX',
  KLSE: 'XKLS', BKK: 'XBKK',
};

const SUFFIX_TO_MIC = {
  AX: 'XASX', AU: 'XASX', ASX: 'XASX',
  L: 'XLON', LN: 'XLON', LSE: 'XLON',
  HK: 'XHKG', HKG: 'XHKG', HKEX: 'XHKG',
  TO: 'XTSE', TSX: 'XTSE', V: 'XTSX', VX: 'XTSX',
  T: 'XTKS', JP: 'XTKS',
  KS: 'XKRX', KQ: 'XKOS',
  SS: 'XSHG', SZ: 'XSHE',
  SW: 'XSWX', SI: 'XSES', SG: 'XSES',
  PA: 'XPAR', DE: 'XETR', F: 'XFRA', MI: 'XMIL',
  BR: 'BVMF', SA: 'BVMF', MX: 'XMEX', MEX: 'XMEX',
  OL: 'XOSL', CO: 'XCSE', ST: 'XSTO', HE: 'XHEL',
  BK: 'XBKK', NZ: 'XNZE', TW: 'XTAI', TWSE: 'XTAI', TA: 'XTAI',
  KL: 'XKLS', JK: 'XIDX',
};

const MIC_TO_TIINGO_PREFIX = {
  XNAS: '', XNYS: '', XASE: '', ARCX: '', BATS: '', IEXG: '',
  XASX: 'ASX', XTSE: 'TSX', XTSX: 'TSXV', XLON: 'LSE', XHKG: 'HKEX',
  XTKS: 'TSE', XSES: 'SGX', XNSE: 'NSE', XBOM: 'BSE',
  XFRA: 'FRA', XETR: 'XETRA', XSWX: 'SWX', XAMS: 'AMS', XBRU: 'BRU',
  XMAD: 'MAD', XPAR: 'PAR', XMIL: 'MIL', XMEX: 'MEX', BVMF: 'BVMF',
  XJSE: 'JSE', XKRX: 'KRX', XKOS: 'KOSDAQ', XSHG: 'SHG', XSHE: 'SHE',
  XNZE: 'NZX', XOSL: 'OSL', XCSE: 'CPH', XSTO: 'STO', XHEL: 'HEL',
  XIDX: 'IDX', XKLS: 'KLSE', XBKK: 'SET', XTAI: 'TWSE',
};

const parseList = (v) => (v || '').split(',').map(s => s.trim()).filter(Boolean);

const normalizeMic = (v) => {
  const up = (v || '').toUpperCase();
  if (!up) return '';
  if (MIC_ALIASES[up]) return MIC_ALIASES[up];
  if (up.startsWith('X') && up.length >= 3) return up;
  return '';
};

const micFromSuffix = (suffix) => SUFFIX_TO_MIC[(suffix || '').toUpperCase()] || '';

const tiingoPrefixForMic = (mic) => {
  if (!mic) return '';
  if (Object.prototype.hasOwnProperty.call(MIC_TO_TIINGO_PREFIX, mic)) return MIC_TO_TIINGO_PREFIX[mic];
  if (mic.startsWith('X') && mic.length > 1) return mic.slice(1);
  return mic;
};

const buildTiingoTicker = (symbol, mic) => {
  const upSymbol = (symbol || '').toUpperCase();
  if (!upSymbol) return '';
  if (upSymbol.includes(':')) return upSymbol;
  const prefix = tiingoPrefixForMic(mic);
  return prefix ? `${prefix}:${upSymbol}` : upSymbol;
};

function resolveSymbolRequests(symbolParam, exchangeParam) {
  const rawSymbols = parseList(symbolParam);
  const exchangeTokens = parseList(exchangeParam);
  const uniqueEx = Array.from(new Set(exchangeTokens.filter(Boolean).map(s => s.toUpperCase())));
  const defaults = rawSymbols.length ? rawSymbols : ['AAPL'];
  const requests = [];

  defaults.forEach((raw, idx) => {
    const upper = (raw || '').trim().toUpperCase();
    if (!upper) return;

    let baseSymbol = upper;
    let mic = '';

    const colonIdx = upper.indexOf(':');
    if (colonIdx > 0) {
      const prefix = upper.slice(0, colonIdx);
      const rest = upper.slice(colonIdx + 1);
      const inferred = normalizeMic(prefix);
      if (inferred) mic = inferred;
      baseSymbol = rest;
    }

    const dotMatch = baseSymbol.match(/^([A-Z0-9\-]+)\.([A-Z]{1,5})$/);
    if (dotMatch) {
      const suffixMic = micFromSuffix(dotMatch[2]);
      if (suffixMic) {
        mic = mic || suffixMic;
        baseSymbol = dotMatch[1];
      }
    }

    const direct = exchangeTokens[idx] || '';
    const directMic = normalizeMic(direct);
    if (!mic && directMic) mic = directMic;

    if (!mic && uniqueEx.length === 1) {
      const fb = normalizeMic(uniqueEx[0]);
      if (fb) mic = fb;
    }

    const ticker = buildTiingoTicker(baseSymbol, mic);
    const symbol = baseSymbol.toUpperCase();
    const key = `${symbol}::${mic || 'US'}`;
    const aliasKeys = Array.from(new Set([ticker, symbol, upper, baseSymbol]
      .map(v => (v || '').toUpperCase()).filter(Boolean)));

    requests.push({ symbol, mic, ticker, key, aliasKeys });
  });

  const seen = new Set();
  return requests.filter(r => (seen.has(r.key) ? false : (seen.add(r.key), true)));
}

function hashCode(input) {
  const str = (input || 'MOCK').toUpperCase();
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) hash = (hash * 33 + str.charCodeAt(i)) >>> 0;
  return hash || 1;
}
function createRng(seed) {
  let v = seed % 2147483647;
  if (v <= 0) v += 2147483646;
  return () => (v = (v * 16807) % 2147483647, (v - 1) / 2147483646);
}
const roundPrice = (x) => Number(Math.max(x, 0.01).toFixed(2));

function generateMockSeries(symbol, points = 30, mode = 'eod') {
  const key = (symbol || 'MOCK').toUpperCase();
  const rng = createRng(hashCode(key));
  const base = 40 + rng() * 160;
  const stepMs = mode === 'intraday' ? INTRADAY_STEP_MS : DAY_MS;
  const now = Date.now();
  const out = [];
  let prevClose = base;
  for (let i = points - 1; i >= 0; i -= 1) {
    const ts = new Date(now - i * stepMs);
    const rawOpen = prevClose + (rng() - 0.5) * 4;
    const open = roundPrice(rawOpen);
    const rawClose = open + (rng() - 0.5) * 6;
    const close = roundPrice(rawClose);
    const high = roundPrice(Math.max(open, close) + rng() * 3);
    const low = roundPrice(Math.min(open, close) - rng() * 3);
    const price = roundPrice(close);
    out.push({
      symbol: key, date: ts.toISOString(),
      open, high, low, close: price, last: price, price,
      previousClose: roundPrice(prevClose),
      volume: Math.floor(5e5 + rng() * 7e6),
      exchange: '', currency: 'USD',
    });
    prevClose = close;
  }
  return out;
}
const generateMockQuote  = (s) => generateMockSeries(s, 1, 'intraday')[0];
const generateMockQuotes = (symbols) => (symbols.length ? symbols : ['MOCK']).map(generateMockQuote);

const toNumber = (v) => (v == null || v === '' ? null : (Number.isFinite(+v) ? +v : null));
const firstNonNull = (...values) => { for (const v of values) if (v != null) return v; return null; };
const formatDate = (d) => d.toISOString().split('T')[0];
const minutesAgo = (mins) => { const d = new Date(); d.setMinutes(d.getMinutes() - mins); return d; };

async function fetchTiingo(path, params, token) {
  const url = new URL(path, API_BASE);
  url.searchParams.set('token', token);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const resp = await fetch(url);
  const text = await resp.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch (err) {
      if (!resp.ok) throw new Error(`Tiingo ${resp.status}: ${text.slice(0,200)}`);
      throw err;
    }
  }
  if (!resp.ok) {
    const detail = data && typeof data === 'object'
      ? data.message || data.error || data.detail || JSON.stringify(data).slice(0,200)
      : text.slice(0,200) || resp.statusText;
    throw new Error(`Tiingo ${resp.status}: ${detail}`);
  }
  return data;
}

const normalizeQuote = (row, fallbackSymbol) => {
  const symbol = (row?.ticker || row?.symbol || fallbackSymbol || '').toUpperCase();
  const price = toNumber(firstNonNull(row?.last, row?.tngoLast, row?.lastPrice, row?.mid));
  const fallbackClose = toNumber(firstNonNull(row?.close, row?.openPrice));
  const prevClose = toNumber(firstNonNull(row?.prevClose, row?.previousClose, fallbackClose));
  const close = toNumber(price ?? prevClose ?? fallbackClose);
  const baseline = firstNonNull(close, prevClose, fallbackClose);
  const open = toNumber(firstNonNull(row?.open, row?.openPrice, row?.prevClose, prevClose, close));
  const high = toNumber(firstNonNull(row?.high, row?.highPrice, row?.dayHigh, row?.dailyHigh, baseline));
  const low  = toNumber(firstNonNull(row?.low,  row?.lowPrice,  row?.dayLow,  row?.dailyLow,  baseline));
  const volume = toNumber(firstNonNull(row?.volume, row?.lastSize, row?.tngoLastSize));
  const timestamp = row?.timestamp || row?.lastSaleTimestamp || row?.quoteTimestamp ||
                    row?.tngoLastTime || row?.date || new Date().toISOString();
  return {
    symbol, date: timestamp,
    exchange: row?.exchange || row?.exchangeCode || '',
    open, high, low, close, last: close, price: close,
    previousClose: prevClose ?? null,
    volume, currency: 'USD',
  };
};

const normalizeCandle = (row, symbol, prevRow) => {
  const close = toNumber(firstNonNull(row?.close, row?.last, row?.adjClose, row?.tngoLast));
  const prevClose = toNumber(firstNonNull(
    row?.prevClose, row?.adjPrevClose, prevRow?.close, prevRow?.adjClose, prevRow?.last
  ));
  const open = toNumber(firstNonNull(row?.open, row?.adjOpen, row?.prevClose, prevClose, close));
  const high = toNumber(firstNonNull(row?.high, row?.adjHigh, row?.highPrice, close, prevClose));
  const low  = toNumber(firstNonNull(row?.low,  row?.adjLow,  row?.lowPrice,  close, prevClose));
  const volume = toNumber(firstNonNull(row?.volume, row?.adjVolume, row?.sharesOutstanding, row?.volumeNotional));
  return {
    symbol: (row?.symbol || row?.ticker || symbol || '').toUpperCase(),
    date: row?.date || row?.timestamp || new Date().toISOString(),
    open, high, low, close, last: close, price: close,
    previousClose: prevClose ?? null,
    volume, exchange: row?.exchange || row?.exchangeCode || '', currency: 'USD',
  };
};

const minutesForInterval = (interval) => (interval === '30min' ? 30 : interval === '1hour' ? 60 : 5);

async function loadIntradayLatest(requests, token) {
  if (!requests.length) return new Map();
  const tickers = Array.from(new Set(requests.map(r => r.ticker).filter(Boolean)));
  if (!tickers.length) return new Map();
  const data = await fetchTiingo('/iex', { tickers: tickers.join(',') }, token);
  const rows = Array.isArray(data) ? data : [];
  const source = new Map();
  rows.forEach((row) => {
    [row?.ticker, row?.symbol, row?.requestTicker]
      .map(k => (k || '').toUpperCase()).filter(Boolean)
      .forEach(k => { if (!source.has(k)) source.set(k, row); });
  });
  const out = new Map();
  requests.forEach((req) => {
    let match = null;
    for (const key of req.aliasKeys) {
      if (source.has(key)) { match = source.get(key); break; }
    }
    if (match) {
      const normalized = normalizeQuote(match, req.symbol);
      normalized.symbol = req.symbol;
      if (req.mic) normalized.exchange = req.mic;
      out.set(req.symbol, normalized);
    }
  });
  return out;
}

async function loadEodLatest(requests, token) {
  if (!requests.length) return new Map();
  const start = formatDate(minutesAgo(60 * 24 * 14));
  const pairs = await Promise.all(
    requests.map(async (req) => {
      if (!req.ticker) return null;
      try {
        const path = `/tiingo/daily/${encodeURIComponent(req.ticker)}/prices`;
        const data = await fetchTiingo(path, { startDate: start, resampleFreq: 'daily' }, token);
        const rows = Array.isArray(data) ? data : [];
        const latest = rows[rows.length - 1];
        const prev = rows.length > 1 ? rows[rows.length - 2] : null;
        if (!latest) return null;
        const normalized = normalizeCandle(latest, req.symbol, prev);
        normalized.symbol = req.symbol;
        if (req.mic) normalized.exchange = req.mic;
        return [req.symbol, normalized];
      } catch { return null; }
    })
  );
  const out = new Map();
  pairs.forEach((e) => { if (e) out.set(e[0], e[1]); });
  return out;
}

async function loadIntraday(request, interval, limit, token) {
  if (!request || !request.ticker) return [];
  const freq = interval || '5min';
  const step = minutesForInterval(freq);
  const lookback = step * Math.max(Number(limit) || 1, 1) + step * 6;
  const startDate = minutesAgo(lookback).toISOString();
  const path = `/iex/${encodeURIComponent(request.ticker)}/prices`;
  const data = await fetchTiingo(path, { startDate, resampleFreq: freq }, token);
  const rows = Array.isArray(data) ? data : [];
  const count = Math.max(Number(limit) || 30, 1);
  const sliced = rows.slice(-count);
  return sliced.map((row, idx) => {
    const normalized = normalizeCandle(row, request.symbol, idx > 0 ? sliced[idx - 1] : null);
    normalized.symbol = request.symbol;
    if (request.mic) normalized.exchange = request.mic;
    return normalized;
  });
}

async function loadEod(request, limit, token) {
  if (!request || !request.ticker) return [];
  const count = Math.max(Number(limit) || 30, 1);
  const daysBack = Math.max(Math.ceil(count * 1.7), 60);
  const startDate = formatDate(minutesAgo(daysBack * 24 * 60));
  const path = `/tiingo/daily/${encodeURIComponent(request.ticker)}/prices`;
  const data = await fetchTiingo(path, { startDate, resampleFreq: 'daily' }, token);
  const rows = Array.isArray(data) ? data : [];
  const sliced = rows.slice(-count);
  return sliced.map((row, idx) => {
    const normalized = normalizeCandle(row, request.symbol, idx > 0 ? sliced[idx - 1] : null);
    normalized.symbol = request.symbol;
    if (request.mic) normalized.exchange = request.mic;
    return normalized;
  });
}

async function handleTiingoRequest(request) {
  const url = new URL(request.url);
  const symbolParam = url.searchParams.get('symbol') || 'AAPL';
  const kind = url.searchParams.get('kind') || 'eod';
  const interval = url.searchParams.get('interval') || '';
  const limit = Number(url.searchParams.get('limit')) || 30;
  const exchangeParam = url.searchParams.get('exchange') || '';

  const requests = resolveSymbolRequests(symbolParam, exchangeParam);
  const isQuoteRequest = kind === 'intraday_latest' || kind === 'eod_latest';
  const seriesMode = kind === 'intraday' ? 'intraday' : 'eod';

  const sendMock = (mode, extra = {}, init = {}) => {
    const { seriesMode: overrideSeriesMode, ...rest } = extra;
    const list = requests.length ? requests.map((r) => r.symbol) : ['MOCK'];
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
      const quoteMap = await loadIntradayLatest(requests, token);
      const map = new Map();
      requests.forEach((req) => { if (quoteMap.has(req.symbol)) map.set(req.symbol, quoteMap.get(req.symbol)); });

      let usedEodFallback = false;
      let usedMockFallback = false;

      const missing = requests.filter((req) => !map.has(req.symbol));
      if (missing.length) {
        const fallbackMap = await loadEodLatest(missing, token);
        missing.forEach((req) => {
          if (map.has(req.symbol)) return;
          const fallbackRow = fallbackMap.get(req.symbol);
          if (fallbackRow) { map.set(req.symbol, fallbackRow); usedEodFallback = true; }
        });
      }
      const stillMissing = requests.filter((req) => !map.has(req.symbol));
      if (stillMissing.length) {
        const mocks = generateMockQuotes(stillMissing.map((req) => req.symbol));
        mocks.forEach((mock, idx) => {
          const req = stillMissing[idx]; if (!req) return;
          const clone = { ...mock, symbol: req.symbol };
          if (req.mic) clone.exchange = req.mic;
          map.set(req.symbol, clone);
        });
        usedMockFallback = true;
      }
      data = requests.map((req) => map.get(req.symbol)).filter(Boolean);

      if (usedMockFallback) {
        warning = 'Some symbols are unavailable from Tiingo in real time; displaying sample data for those tickers.';
      } else if (usedEodFallback) {
        warning = 'Some symbols are using end-of-day fallback prices because real-time quotes were unavailable.';
      }
    } else if (kind === 'eod_latest') {
      const eodMap = await loadEodLatest(requests, token);
      data = requests.map((req) => eodMap.get(req.symbol)).filter(Boolean);
    } else if (kind === 'intraday') {
      const target = requests[0] || { symbol: 'AAPL', ticker: 'AAPL', mic: '' };
      data = await loadIntraday(target, interval, limit, token);
      if (!data.length) {
        const fallback = await loadEod(target, limit, token);
        if (fallback.length) {
          data = fallback;
          warning = 'Showing end-of-day prices because intraday data was unavailable.';
        }
      }
    } else {
      const target = requests[0] || { symbol: 'AAPL', ticker: 'AAPL', mic: '' };
      data = await loadEod(target, limit, token);
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
}

export default handleTiingoRequest;

// Netlify runtime compatibility
export const handler = async (event) => {
  const rawQuery = event?.rawQuery ?? event?.rawQueryString ?? '';
  const path = event?.path || '/api/tiingo';
  const host = event?.headers?.host || 'example.org';
  const url = event?.rawUrl || `https://${host}${path}${rawQuery ? `?${rawQuery}` : ''}`;
  const method = event?.httpMethod || 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : event?.body;

  const request = new Request(url, { method, headers: event?.headers || {}, body });
  const response = await handleTiingoRequest(request);
  const headers = {}; response.headers.forEach((v, k) => { headers[k] = v; });

  return { statusCode: response.status, headers, body: await response.text() };
};
