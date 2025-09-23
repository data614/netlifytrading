import { searchLocalSymbols } from './lib/localSymbolSearch.js';
import { getTiingoToken } from './lib/env.js';

const corsHeaders = { 'access-control-allow-origin': process.env.ALLOWED_ORIGIN || '*' };
const DEFAULT_LIMIT = 25;

export default async (request) => {
  const url = new URL(request.url);
  let q = url.searchParams.get('q') || '';
  let exchangeFilter = url.searchParams.get('exchange') || '';
  const limitParam = Number.parseInt(url.searchParams.get('limit') || '', 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : DEFAULT_LIMIT;

  // Basic parsing to support queries like "ASX:WOW" or "WOW.AX"
  const colon = q.match(/^([A-Za-z]{2,5})\s*:\s*([A-Za-z0-9.\-]+)$/);
  if (colon) {
    exchangeFilter = exchangeFilter || mapPrefix(colon[1]);
    q = colon[2];
  } else {
    const dot = q.match(/^([A-Za-z0-9\-]+)\.([A-Za-z]{1,4})$/);
    if (dot) {
      q = dot[1];
      exchangeFilter = exchangeFilter || mapSuffix(dot[2]);
    }
  }

  const cleanedQuery = q.trim();
  const localMatches = cleanedQuery
    ? searchLocalSymbols(cleanedQuery, { micFilter: exchangeFilter, limit })
    : [];

  const token = getTiingoToken();
  if (!token) {
    return Response.json({ data: localMatches }, { headers: corsHeaders });
  }

  try {
    const remoteMatches = cleanedQuery.length >= 2
      ? await fetchTiingoMatches(cleanedQuery, token, exchangeFilter, limit)
      : [];
    const combined = mergeResults(localMatches, remoteMatches, limit);
    return Response.json({ data: combined }, { headers: corsHeaders });
  } catch (e) {
    const fallback = localMatches.length ? localMatches : [];
    return Response.json(
      { data: fallback, warning: 'tiingo search failed', detail: String(e) },
      { status: 200, headers: corsHeaders }
    );
  }
};

async function fetchTiingoMatches(query, token, exchangeFilter, limit) {
  const api = new URL('https://api.tiingo.com/tiingo/utilities/search');
  api.searchParams.set('query', query);
  api.searchParams.set('token', token);
  const resp = await fetch(api);
  if (!resp.ok) {
    throw new Error(`tiingo responded with ${resp.status}`);
  }
  const body = await resp.json();
  const items = Array.isArray(body) ? body : [];
  const deduped = new Map();
  for (const item of items) {
    const symbol = (item.ticker || item.permaTicker || '').toUpperCase();
    if (!symbol) continue;
    const exchangeCode = (item.exchange || item.exchangeCode || '').toUpperCase();
    const mic = mapExchangeCodeToMic(exchangeCode);
    if (exchangeFilter && mic && exchangeFilter !== mic && exchangeFilter !== exchangeCode) continue;
    const key = `${symbol}::${mic}`;
    if (deduped.has(key)) continue;
    deduped.set(key, {
      symbol,
      name: item.name || '',
      exchange: exchangeCode || '',
      mic,
      country: item.country || '',
      currency: item.currency || '',
      type: item.assetType || '',
      source: 'tiingo',
    });
    if (deduped.size >= limit * 2) break;
  }
  return Array.from(deduped.values());
}

function mergeResults(primary, secondary, limit) {
  const seen = new Set();
  const merged = [];

  const add = (item) => {
    if (!item || !item.symbol) return;
    const key = `${item.symbol.toUpperCase()}::${(item.mic || '').toUpperCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  };

  primary.forEach(add);
  if (merged.length < limit) {
    secondary.forEach((item) => {
      if (merged.length >= limit) return;
      add(item);
    });
  }

  return merged.slice(0, limit);
}

// Helpers for exchange alias mapping
function mapPrefix(prefix) {
  const up = prefix.toUpperCase();
  const aliases = {
    ASX: 'XASX',
    AU: 'XASX',
    AUS: 'XASX',
    LSE: 'XLON',
    LON: 'XLON',
    HK: 'XHKG',
    HKG: 'XHKG',
    HKEX: 'XHKG',
    HKSE: 'XHKG',
    SGX: 'XSES',
    NSE: 'XNSE',
    BSE: 'XBOM',
    TSX: 'XTSE',
    TSE: 'XTSE',
    JP: 'XTKS',
    TYO: 'XTKS',
    JPX: 'XTKS',
    TSEJP: 'XTKS',
    NYSE: 'XNYS',
    NASDAQ: 'XNAS',
    AMEX: 'XASE',
    ARCA: 'ARCX',
    BATS: 'BATS',
  };
  if (up.startsWith('X')) return up;
  return aliases[up] || up;
}

function mapSuffix(suffix) {
  const up = suffix.toUpperCase();
  const map = {
    AX: 'XASX',
    ASX: 'XASX',
    AU: 'XASX',
    A: 'XASX',
    L: 'XLON',
    LSE: 'XLON',
    HK: 'XHKG',
    H: 'XHKG',
    HKG: 'XHKG',
    TO: 'XTSE',
    T: 'XTKS',
    DE: 'XETR',
    NS: 'XNSE',
    BO: 'XBOM',
    SW: 'XSWX',
    SG: 'XSES',
    SI: 'XSES',
  };
  return map[up] || '';
}

function mapExchangeCodeToMic(code) {
  const up = (code || '').toUpperCase();
  const map = {
    NASDAQ: 'XNAS',
    NASDAQCM: 'XNAS',
    NASDAQGM: 'XNAS',
    NASDAQGS: 'XNAS',
    NAS: 'XNAS',
    NYSE: 'XNYS',
    NYSEARCA: 'ARCX',
    'NYSE ARCA': 'ARCX',
    ARCA: 'ARCX',
    BATS: 'BATS',
    AMEX: 'XASE',
    NYSEMKT: 'XASE',
    'NYSE MKT': 'XASE',
    ASX: 'XASX',
    TSX: 'XTSE',
    TSXV: 'XTSX',
    LSE: 'XLON',
    LONDON: 'XLON',
    HKEX: 'XHKG',
    HKSE: 'XHKG',
    SEHK: 'XHKG',
    TSE: 'XTKS',
    TOKYO: 'XTKS',
    SGX: 'XSES',
    NSE: 'XNSE',
    BSE: 'XBOM',
    SIX: 'XSWX',
    SWX: 'XSWX',
    ETR: 'XETR',
  };
  if (up.startsWith('X') && up.length >= 3) return up;
  return map[up] || '';
}
