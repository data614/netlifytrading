import { getTiingoToken, getTiingoTokenDetail, TIINGO_TOKEN_ENV_KEYS } from './lib/env.js';
import crypto from 'node:crypto';

// --- Configuration & Constants ---

const API_BASE = 'https://api.tiingo.com';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const corsHeaders = { 'access-control-allow-origin': ALLOWED_ORIGIN };

const DAY_MS = 24 * 60 * 60 * 1000;
const INTRADAY_MS = 5 * 60 * 1000;
const EOD_LOOKBACK_DAYS = 400;
const DEFAULT_EOD_POINTS = 30;
const DEFAULT_INTRADAY_POINTS = 150;
const MAX_POINTS = 2000;

// Debug & resilience knobs
const EXPOSE_TOKEN_PREVIEW = String(process.env.EXPOSE_TOKEN_PREVIEW || 'true').toLowerCase() !== 'false';
const TIINGO_TIMEOUT_MS = Number(process.env.TIINGO_TIMEOUT_MS || 8000);
const TIINGO_RETRIES = Number(process.env.TIINGO_RETRIES || 2);
const DEBUG_DEFAULT = String(process.env.TIINGO_DEBUG_DEFAULT || 'false').toLowerCase() === 'true';

// --- Mock Data Generators ---

function seed(s) {
  let v = 1;
  for (let i = 0; i < s.length; i++) v = (v * 33 + s.charCodeAt(i)) >>> 0;
  return () => {
    v = (v * 16807) % 2147483647;
    return (v - 1) / 2147483646;
  };
}

const round = (x) => Number(Math.max(x, 0.01).toFixed(2));

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
      open, high, low, close,
      last: close, price: close,
      previousClose: round(previousPrice),
      volume: Math.floor(1e6 * rng()),
      exchange: '', currency: 'USD',
    });
    previousPrice = close;
  }
  return out;
}
const mockQuote = (s) => mockSeries(s, 1, 'intraday')[0];

// --- API Helpers ---

const lastTiingoMeta = { limit: null, remaining: null, reset: null };

function redactUrl(u) {
  try {
    const copy = new URL(u);
    copy.searchParams.delete('token');
    return copy.toString();
  } catch { return String(u); }
}

function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

async function fetchWithRetry(url, { timeoutMs = TIINGO_TIMEOUT_MS, retries = TIINGO_RETRIES }, ctx) {
  let attempt = 0;
  while (attempt <= retries) {
    const started = Date.now();
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(t);
      ctx?.steps?.push({ type: 'fetch', url: redactUrl(url), status: response.status, ok: response.ok, elapsedMs: Date.now() - started, attempt });
      if (!response.ok && [429,500,502,503,504].includes(response.status) && attempt < retries) {
        await delay(150 * 2 ** attempt + Math.random()*100);
        attempt++;
        continue;
      }
      return { response };
    } catch (err) {
      clearTimeout(t);
      ctx?.steps?.push({ type: 'fetch-error', url: redactUrl(url), error: String(err.message||err), attempt });
      if (attempt < retries) {
        await delay(150 * 2 ** attempt + Math.random()*100);
        attempt++;
        continue;
      }
      throw err;
    }
  }
}

async function tiingo(path, params, token, ctx) {
  const url = new URL(path, API_BASE);
  url.searchParams.set('token', token);
  for (const [k,v] of Object.entries(params||{})) if (v) url.searchParams.set(k,v);
  const { response } = await fetchWithRetry(url, {}, ctx);
  const text = await response.text();
  let data = null;
  if (text) try { data = JSON.parse(text); } catch {}
  if (!response.ok) throw new Error(`Tiingo ${response.status}: ${text||response.statusText}`);
  lastTiingoMeta.limit = response.headers.get('x-ratelimit-limit');
  lastTiingoMeta.remaining = response.headers.get('x-ratelimit-remaining');
  lastTiingoMeta.reset = response.headers.get('x-ratelimit-reset');
  return data;
}

function metaHeaders(ctx) {
  const chosenKey = TIINGO_TOKEN_ENV_KEYS.find(k => process.env?.[k]);
  const token = getTiingoToken();
  const preview = EXPOSE_TOKEN_PREVIEW && token ? `${token.slice(0,4)}...${token.slice(-4)}` : '';
  const detail = getTiingoTokenDetail?.() || {};
  return {
    'x-tiingo-chosen-key': chosenKey || '',
    'x-tiingo-token-preview': preview,
    ...(detail.source ? { 'x-tiingo-token-source': detail.source } : {}),
    ...(detail.keyName ? { 'x-tiingo-token-key': detail.keyName } : {}),
    ...(lastTiingoMeta.limit ? { 'x-tiingo-ratelimit-limit': lastTiingoMeta.limit } : {}),
    ...(lastTiingoMeta.remaining ? { 'x-tiingo-ratelimit-remaining': lastTiingoMeta.remaining } : {}),
    ...(lastTiingoMeta.reset ? { 'x-tiingo-ratelimit-reset': lastTiingoMeta.reset } : {}),
    ...(ctx?.id ? { 'x-tiingo-request-id': ctx.id } : {}),
  };
}

function ok(body,{ctx,debug}={}) {
  const elapsed = Date.now() - (ctx?.startedAt||Date.now());
  const payload = debug ? { ...body, debug: { id: ctx?.id, steps: ctx?.steps, elapsedMs: elapsed } } : body;
  return new Response(JSON.stringify(payload), { status:200, headers:{ ...corsHeaders, ...metaHeaders(ctx), 'content-type':'application/json', 'x-response-time-ms':String(elapsed)} });
}

function mock(body,{ctx,debug,reason}={}) {
  const data = body.mode==='quotes' ? [mockQuote(body.symbol)] : mockSeries(body.symbol, body.limit, body.mode==='intraday'?'intraday':'eod');
  const resp = { symbol: body.symbol, data, warning: body.warning||'Tiingo data unavailable. Showing sample data.' };
  const payload = debug ? { ...resp, debug:{ id: ctx?.id, steps: ctx?.steps }} : resp;
  return new Response(JSON.stringify(payload), { status:200, headers:{ ...corsHeaders, ...metaHeaders(ctx), 'x-tiingo-fallback':'mock', ...(reason?{'x-tiingo-fallback-reason':reason}:{}) } });
}

// --- Data Loading ---

async function loadEod(symbol, limit, token, ctx) {
  const count = Math.max(Number(limit)||DEFAULT_EOD_POINTS,1);
  const startDate = new Date(Date.now()-EOD_LOOKBACK_DAYS*DAY_MS).toISOString().slice(0,10);
  const rows = await tiingo(`/tiingo/daily/${encodeURIComponent(symbol)}/prices`,{startDate,resampleFreq:'daily'},token,ctx);
  const list = Array.isArray(rows)?rows.slice(-count):[];
  return list.map((r,i)=>({symbol:symbol.toUpperCase(), date:r.date||new Date().toISOString(), open:r.open, high:r.high, low:r.low, close:r.close, last:r.close, price:r.close, previousClose:i>0?list[i-1].close:r.prevClose, volume:r.volume, exchange:r.exchange||'', currency:r.currency||'USD'}));
}

async function loadIntraday(symbol, interval, limit, token, ctx) {
  const freq = interval||'5min';
  const count = Math.max(Number(limit)||DEFAULT_INTRADAY_POINTS,1);
  const lookbackMins = (freq==='30min'?30:freq==='1hour'?60:5) * (count+12);
  const startDate = new Date(Date.now()-lookbackMins*60000).toISOString();
  const rows = await tiingo(`/iex/${encodeURIComponent(symbol)}/prices`,{startDate,resampleFreq:freq},token,ctx);
  const list = Array.isArray(rows)?rows.slice(-count):[];
  return list.map((r,i)=>({symbol:symbol.toUpperCase(),date:r.date||new Date().toISOString(),open:r.open??r.prevClose,high:r.high,low:r.low,close:r.close??r.last,last:r.last??r.close,price:r.last??r.close,previousClose:i>0?list[i-1].close:r.prevClose,volume:r.volume,exchange:r.exchange||'',currency:r.currency||'USD'}));
}

async function loadIntradayLatest(symbol, token, ctx) {
  const data = await tiingo('/iex',{tickers:symbol},token,ctx);
  const row = Array.isArray(data)?data.find(r=>(r.ticker||r.symbol||'').toUpperCase()===symbol.toUpperCase()):null;
  if (!row) return null;
  const price = row.last ?? row.tngoLast ?? row.lastPrice ?? row.mid;
  const prev = row.prevClose ?? row.previousClose ?? row.close ?? row.openPrice;
  return {symbol:symbol.toUpperCase(),date:row.timestamp||new Date().toISOString(),exchange:row.exchange||'',open:row.open??prev,high:row.high??price,low:row.low??price,close:price,last:price,price,previousClose:prev,volume:row.volume,currency:row.currency||'USD'};
}

// --- Helpers ---

const sanitizeSymbol = (s)=> (String(s||'').toUpperCase().replace(/[^A-Z0-9.\-]/g,'')||'AAPL').slice(0,16);
const clampInt = (v,min,max,f)=>{const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(n,max)):f;};
const wantsDebug = (url,h)=> DEBUG_DEFAULT || ['1','true'].includes((url.searchParams.get('debug')||'').toLowerCase()) || ['1','true'].includes((h.get?.('x-debug')||'').toLowerCase());

// --- Main Handler ---

async function handleTiingoRequest(request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind')||'eod';
  const symbol = sanitizeSymbol(url.searchParams.get('symbol')||'AAPL');
  const interval = url.searchParams.get('interval')||'';
  const limit = clampInt(url.searchParams.get('limit'),1,MAX_POINTS,DEFAULT_EOD_POINTS);
  const mode = (url.searchParams.get('mode')||'auto').toLowerCase();
  const ctx = {id:crypto.randomUUID?.()||Math.random().toString(16).slice(2),steps:[],startedAt:Date.now()};
  const debug = wantsDebug(url,request.headers||new Headers());

  const token = getTiingoToken();
  if (!token) return mock({symbol,mode:kind,limit,warning:'Tiingo API key missing. Showing sample data.'},{ctx,debug,reason:'no_token'});
  if (mode==='mock') return mock({symbol,mode:kind,limit,warning:'Mock mode enabled.'},{ctx,debug,reason:'forced_mock'});

  try {
    if (kind==='health') {
      const probe = await loadIntradayLatest('SPY',token,ctx).catch(()=>null);
      return ok({ok:!!probe,symbol:'SPY'}, {ctx,debug});
    }
    if (kind==='intraday_latest') {
      const q = await loadIntradayLatest(symbol,token,ctx);
      if (q) return ok({symbol,data:[q]}, {ctx,debug});
      const eod = await loadEod(symbol,1,token,ctx).catch(()=>[]);
      if (eod.length) return ok({symbol,data:[eod[0]],warning:'Intraday latest unavailable; showing EOD.'},{ctx,debug});
      return mock({symbol,mode:'quotes',warning:'Real-time quotes unavailable. Showing sample data.'},{ctx,debug,reason:'intraday_failed'});
    }
    if (kind==='intraday') {
      const rows = await loadIntraday(symbol,interval,limit,token,ctx);
      if (rows.length) return ok({symbol,data:rows},{ctx,debug});
      const eod = await loadEod(symbol,limit,token,ctx).catch(()=>[]);
      if (eod.length) return ok({symbol,data:eod,warning:'Intraday unavailable; showing EOD.'},{ctx,debug,reason:'intraday_empty'});
      return mock({symbol,mode:'intraday',limit,warning:'Intraday unavailable. Showing sample data.'},{ctx,debug,reason:'intraday_failed'});
    }
    const rows = await loadEod(symbol,limit,token,ctx);
    if (rows.length) return ok({symbol,data:rows},{ctx,debug});
    return mock({symbol,mode:'eod',limit,warning:'EOD unavailable. Showing sample data.'},{ctx,debug,reason:'eod_empty'});
  } catch (err) {
    console.error(JSON.stringify({level:'error',msg:`Tiingo request failed for ${symbol}`,requestId:ctx.id,error:String(err),kind}));
    return mock({symbol,mode:kind,limit,warning:'Tiingo request failed. Showing sample data.'},{ctx,debug,reason:'exception'});
  }
}

export default handleTiingoRequest;

// --- Netlify Entrypoint ---

export const handler = async (event) => {
  if ((event?.httpMethod||'').toUpperCase()==='OPTIONS') {
    return {statusCode:204,headers:{...corsHeaders,'access-control-allow-methods':'GET,HEAD,OPTIONS','access-control-allow-headers':event?.headers?.['access-control-request-headers']||'content-type'},body:''};
  }
  const rawQuery = event?.rawQuery ?? '';
  const path = event?.path || '/';
  const host = event?.headers?.host || 'example.org';
  const url = event?.rawUrl || `https://${host}${path}${rawQuery?`?${rawQuery}`:''}`;
  const method = event?.httpMethod || 'GET';
  const body = method==='GET'||method==='HEAD'?undefined:event?.body;
  const request = new Request(url,{method,headers:event?.headers||{},body});
  const response = await handleTiingoRequest(request);
  const headers={}; response.headers.forEach((v,k)=>{headers[k]=v;});
  return {statusCode:response.status,headers,body:await response.text()};
};
