import { getTiingoToken } from './lib/env.js';

const corsHeaders = { 'access-control-allow-origin': process.env.ALLOWED_ORIGIN || '*' };
const API_BASE = 'https://api.tiingo.com/';

const MIC_ALIASES = {
  NASDAQ: 'XNAS', NAS: 'XNAS', NASD: 'XNAS',
  NYSE: 'XNYS', ARCA: 'ARCX', AMEX: 'XASE', ASE: 'XASE',
  LSE: 'XLON', LON: 'XLON', HKEX: 'XHKG', HKG: 'XHKG', HK: 'XHKG',
  ASX: 'XASX', AU: 'XASX', TSX: 'XTSE', TSXV: 'XTSX',
  JP: 'XTKS', TYO: 'XTKS', TSE: 'XTKS',
  NSE: 'XNSE', BSE: 'XBOM',
  XETRA: 'XETR', ETR: 'XETR', FWB: 'XFRA',
};

const SUFFIX_TO_MIC = {
  AX: 'XASX', ASX: 'XASX', AU: 'XASX',
  L: 'XLON', LN: 'XLON', LSE: 'XLON',
  HK: 'XHKG', H: 'XHKG', HKG: 'XHKG',
  TO: 'XTSE', TSX: 'XTSE', V: 'XTSX',
  T: 'XTKS',
  NS: 'XNSE', BO: 'XBOM',
  DE: 'XETR', F: 'XFRA',
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toNumber = (value) => {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const percent = (value) => {
  if (value == null) return null;
  return value > 1.5 ? value / 100 : value;
};

const mapSuffixToMic = (suffix) => SUFFIX_TO_MIC[(suffix || '').toUpperCase()] || '';
const normalizeMic = (value) => {
  const up = (value || '').toUpperCase();
  if (!up) return '';
  if (up.startsWith('X') && up.length >= 3) return up;
  return MIC_ALIASES[up] || '';
};

function parseSymbols(symbolParam = '', exchangeParam = '') {
  const raw = (symbolParam || '').split(',');
  const fallback = exchangeParam ? normalizeMic(exchangeParam) : '';
  const requests = [];
  raw.forEach((piece) => {
    const trimmed = (piece || '').trim();
    if (!trimmed) return;
    let symbol = trimmed.toUpperCase();
    let mic = '';
    if (symbol.includes(':')) {
      const [prefix, rest] = symbol.split(':');
      mic = normalizeMic(prefix) || mic;
      symbol = rest;
    }
    const dotMatch = symbol.match(/^([A-Z0-9\-]+)\.([A-Z]{1,4})$/);
    if (dotMatch) {
      const suffixMic = mapSuffixToMic(dotMatch[2]);
      if (suffixMic) {
        mic = mic || suffixMic;
        symbol = dotMatch[1];
      }
    }
    requests.push({ symbol, mic: mic || fallback });
  });
  if (!requests.length) requests.push({ symbol: 'AAPL', mic: fallback });
  const seen = new Set();
  return requests.filter((item) => {
    const key = `${item.symbol}::${item.mic}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildTiingoTicker(symbol, mic) {
  if (!symbol) return '';
  if (symbol.includes(':')) return symbol;
  if (!mic) return symbol;
  if (mic === 'XASX') return `ASX:${symbol}`;
  if (mic === 'XLON') return `LSE:${symbol}`;
  if (mic === 'XHKG') return `HKEX:${symbol}`;
  if (mic === 'XTSE') return `TSX:${symbol}`;
  if (mic === 'XTSX') return `TSXV:${symbol}`;
  if (mic === 'XTKS') return `TSE:${symbol}`;
  return symbol;
}

async function fetchTiingo(path, params, token) {
  const url = new URL(path, API_BASE);
  url.searchParams.set('token', token);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, value);
  });
  const response = await fetch(url);
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch (err) { throw new Error(`Tiingo response parse failed: ${text.slice(0, 160)}`); }
  }
  if (!response.ok) {
    const detail = data?.message || data?.error || response.statusText;
    throw new Error(`Tiingo ${response.status}: ${detail}`);
  }
  return data;
}

async function fetchFundamentals(symbol, mic, token) {
  const ticker = buildTiingoTicker(symbol, mic);
  const path = `/tiingo/fundamentals/${encodeURIComponent(ticker)}/daily`;
  const data = await fetchTiingo(path, { limit: 16 }, token);
  return Array.isArray(data) ? data : [];
}

async function fetchNews(symbol, token) {
  const data = await fetchTiingo('/tiingo/news', { tickers: symbol, limit: 20 }, token);
  return Array.isArray(data) ? data : [];
}

async function fetchQuotes(symbols, token) {
  if (!symbols.length) return new Map();
  const data = await fetchTiingo('/iex', { tickers: symbols.join(',') }, token);
  const rows = Array.isArray(data) ? data : [];
  const map = new Map();
  rows.forEach((row) => {
    const keys = [row?.ticker, row?.symbol, row?.requestTicker]
      .map((v) => (v || '').toUpperCase())
      .filter(Boolean);
    keys.forEach((key) => {
      map.set(key, row);
      const colon = key.indexOf(':');
      if (colon > 0) map.set(key.slice(colon + 1), row);
    });
  });
  return map;
}

function formatMagnitude(value) {
  const num = toNumber(value);
  if (!num) return '—';
  const abs = Math.abs(num);
  if (abs >= 1e12) return `${(num / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return num.toFixed(2);
}

function computeValuation(metrics, price) {
  const baselinePrice = price || toNumber(metrics.price) || 0;
  const eps = toNumber(metrics.eps) || toNumber(metrics.epsTtm) || toNumber(metrics.dilutedEps) || (baselinePrice / 20) || 0;
  const growth = clamp(percent(metrics.revenueGrowth) ?? 0.05, -0.2, 0.35);
  const margin = clamp(percent(metrics.operatingMargin) ?? percent(metrics.netMargin) ?? 0.2, -0.3, 0.6);
  const cashflow = toNumber(metrics.freeCashFlowPerShare) || (eps * (0.8 + margin));
  const forwardPe = clamp(toNumber(metrics.forwardPe) || toNumber(metrics.pe) || 18, 8, 40);
  const targetPe = clamp(forwardPe * (1 + growth * 1.4 + margin * 0.3), 8, 48);
  const multiples = eps ? eps * targetPe : baselinePrice;
  const marginPremium = baselinePrice * (1 + margin * 0.6);
  const discount = 0.09;
  let dcf = baselinePrice;
  if (cashflow && discount > growth) {
    dcf = cashflow * (1 + growth) / (discount - growth);
  }
  const candidates = [baselinePrice, multiples, marginPremium, dcf].filter((x) => Number.isFinite(x) && x > 1);
  const fairValue = candidates.length ? candidates.reduce((a, b) => a + b, 0) / candidates.length : baselinePrice;
  const rangeLow = fairValue * 0.88;
  const rangeHigh = fairValue * 1.18;
  const upside = baselinePrice ? (fairValue - baselinePrice) / baselinePrice : 0;
  let signalLabel = 'Fairly valued';
  let signalClass = '';
  if (upside >= 0.18) { signalLabel = 'Strong upside'; signalClass = 'ok'; }
  else if (upside >= 0.07) { signalLabel = 'Moderate upside'; signalClass = 'ok'; }
  else if (upside <= -0.12) { signalLabel = 'Overvalued'; signalClass = 'error'; }
  else if (upside <= -0.05) { signalLabel = 'Slight downside'; signalClass = 'error'; }
  return {
    fairValue,
    rangeLow,
    rangeHigh,
    methodology: 'Hybrid cashflow & multiples model',
    upside,
    signalLabel,
    signalClass,
  };
}

function computeQualityScore(metrics) {
  const growth = clamp(percent(metrics.revenueGrowth) ?? 0.05, -0.3, 0.4);
  const margin = clamp(percent(metrics.operatingMargin) ?? percent(metrics.netMargin) ?? 0.15, -0.25, 0.6);
  const roe = clamp(percent(metrics.returnOnEquity) ?? 0.12, -0.2, 0.5);
  const freeCash = toNumber(metrics.freeCashFlowPerShare) ?? 0;
  const leverage = toNumber(metrics.debtToEquity) ?? 0.6;
  const dividend = percent(metrics.dividendYield) ?? 0;
  const growthScore = 55 + growth * 120;
  const marginScore = 50 + margin * 160;
  const roeScore = 55 + roe * 150;
  const cashScore = freeCash > 0 ? 65 : 45;
  const dividendScore = dividend > 0.02 ? 60 : dividend > 0.005 ? 50 : 40;
  const leveragePenalty = leverage > 2 ? (leverage - 2) * 25 : leverage > 1 ? (leverage - 1) * 12 : leverage < 0.3 ? -5 : 0;
  const raw = growthScore * 0.3 + marginScore * 0.25 + roeScore * 0.2 + cashScore * 0.15 + dividendScore * 0.1 - leveragePenalty;
  return clamp(Math.round(raw), 5, 95);
}

function computeMomentumScore(price, metrics) {
  const high = toNumber(metrics.week52High) || toNumber(metrics.price52WeekHigh) || price;
  const low = toNumber(metrics.week52Low) || toNumber(metrics.price52WeekLow) || price;
  const range = high && low ? high - low : null;
  const percentile = range && range > 0 ? clamp((price - low) / range, -0.2, 1.2) : 0.5;
  const monthChange = percent(metrics.monthChange) ?? percent(metrics.priceChange1Month) ?? 0;
  const quarterChange = percent(metrics.quarterChange) ?? percent(metrics.priceChange3Month) ?? 0;
  const signal = percentile * 70 + (monthChange * 100) * 0.15 + (quarterChange * 100) * 0.15 + 25;
  return clamp(Math.round(signal), 5, 95);
}

function normaliseNews(list = []) {
  return list.slice(0, 8).map((item) => ({
    date: item?.publishedDate || item?.date || item?.timestamp || new Date().toISOString(),
    type: item?.tags?.[0] || item?.categories?.[0] || 'News',
    headline: item?.title || item?.description || 'News item',
    summary: item?.description || item?.snippet || '',
    url: item?.url || '',
    importance: item?.sentimentScore > 0.25 ? 'Positive' : item?.sentimentScore < -0.25 ? 'Watch' : 'Neutral',
  }));
}

function deriveDocuments(news = [], symbol = '') {
  const filings = news.filter((item) => (item?.url || '').includes('sec.gov') || /10\-|8\-K|prospectus|earnings call/i.test(item?.title || ''))
    .slice(0, 6)
    .map((item) => ({
      date: item?.date || item?.publishedDate || new Date().toISOString(),
      type: /transcript/i.test(item?.title || '') ? 'Transcript' : /10-|8-K/i.test(item?.title || '') ? 'SEC Filing' : 'Document',
      title: item?.headline || item?.title || `${symbol} filing`,
      url: item?.url || '',
      summary: item?.summary || '',
    }));
  if (filings.length) return filings;
  return [
    {
      date: new Date().toISOString(),
      type: 'SEC Filing',
      title: `${symbol} Form 10-K (illustrative)`,
      url: 'https://www.sec.gov/',
      summary: 'Sample filing reference — configure TIINGO or SEC feeds for live data.',
    },
    {
      date: new Date(Date.now() - 90 * 86400000).toISOString(),
      type: 'Earnings transcript',
      title: `${symbol} Q&A session (illustrative)`,
      url: 'https://www.sec.gov/',
      summary: 'Replace with actual transcript once API keys are configured.',
    },
  ];
}

function buildHistory(rows = []) {
  const sorted = rows.slice().sort((a, b) => new Date(b.reportDate || b.date || 0) - new Date(a.reportDate || a.date || 0));
  return sorted.slice(0, 8).map((row) => ({
    period: row.reportDate || row.date || '—',
    revenueGrowth: percent(row.revenueGrowth) ?? percent(row.revenueYoY) ?? percent(row.revenueGrowthTTM) ?? 0,
    eps: toNumber(row.eps) ?? toNumber(row.epsTtm) ?? toNumber(row.dilutedEPS) ?? null,
    margin: percent(row.operatingMargin) ?? percent(row.netMargin) ?? percent(row.operatingMarginTTM) ?? null,
    leverage: toNumber(row.debtToEquity) ?? toNumber(row.totalDebtToEquity) ?? null,
  }));
}

function formatKeyMetrics(metrics, valuations) {
  return [
    { label: 'Market cap', value: formatMagnitude(metrics.marketCap) },
    { label: 'Forward P/E', value: metrics.forwardPe ? metrics.forwardPe.toFixed(1) : '—' },
    { label: 'PEG (est)', value: metrics.pe && percent(metrics.revenueGrowth) ? (metrics.pe / Math.max(percent(metrics.revenueGrowth), 0.01)).toFixed(2) : '—' },
    { label: 'Dividend yield', value: percent(metrics.dividendYield) != null ? `${(percent(metrics.dividendYield) * 100).toFixed(2)}%` : '—' },
    { label: 'FCF / share', value: metrics.freeCashFlowPerShare != null ? metrics.freeCashFlowPerShare.toFixed(2) : '—' },
    { label: 'Fair value range', value: `${valuations ? valuations.rangeLow.toFixed(2) : '—'} – ${valuations ? valuations.rangeHigh.toFixed(2) : '—'}` },
  ];
}

function buildNarrative(symbol, valuations, qualityScore, momentumScore, events) {
  const tone = valuations?.upside > 0.15 ? 'upside skew' : valuations?.upside < -0.05 ? 'valuation stretch' : 'balanced setup';
  const catalyst = events?.[0]?.headline || 'monitor upcoming filings and macro catalysts';
  return `${symbol} screens with ${tone}. Quality ${qualityScore}/100, momentum ${momentumScore}/100. Immediate catalyst: ${catalyst}.`;
}

function normaliseRecord(entry, fundamentals = [], quote = null, news = []) {
  const sorted = fundamentals.slice().sort((a, b) => new Date(b.reportDate || b.date || 0) - new Date(a.reportDate || a.date || 0));
  const latest = sorted[0] || {};
  const currency = latest?.currencyCode || latest?.currency || quote?.currency || 'USD';
  const price = toNumber(quote?.last) || toNumber(latest?.close) || toNumber(latest?.adjClose) || toNumber(latest?.tngoLast) || 0;
  const prevClose = toNumber(quote?.prevClose) || toNumber(latest?.prevClose) || toNumber(latest?.adjPrevClose) || price;
  const metrics = {
    price,
    pe: toNumber(latest?.peRatio) || toNumber(latest?.peRatioTTM),
    forwardPe: toNumber(latest?.forwardPERatio) || toNumber(latest?.forwardPe),
    revenueGrowth: percent(latest?.revenueGrowth) ?? percent(latest?.revenueGrowthTTM),
    eps: toNumber(latest?.eps) || toNumber(latest?.epsTTM) || toNumber(latest?.dilutedEPS),
    epsTtm: toNumber(latest?.epsTTM) || null,
    dividendYield: percent(latest?.dividendYield),
    operatingMargin: percent(latest?.operatingMargin) ?? percent(latest?.operatingMarginTTM),
    netMargin: percent(latest?.netMargin) ?? percent(latest?.netMarginTTM),
    grossMargin: percent(latest?.grossMargin) ?? percent(latest?.grossMarginTTM),
    freeCashFlowPerShare: toNumber(latest?.freeCashFlowPerShare) || toNumber(latest?.freeCashFlowPerShareTTM),
    returnOnEquity: percent(latest?.returnOnEquity) ?? percent(latest?.roe),
    debtToEquity: toNumber(latest?.debtToEquity) ?? toNumber(latest?.totalDebtToEquity),
    marketCap: toNumber(latest?.marketCap) || toNumber(quote?.marketCap),
    week52High: toNumber(latest?.week52High) || toNumber(latest?.price52WeekHigh),
    week52Low: toNumber(latest?.week52Low) || toNumber(latest?.price52WeekLow),
    monthChange: percent(latest?.priceChange1Month) ?? percent(latest?.monthChange),
    quarterChange: percent(latest?.priceChange3Month) ?? percent(latest?.quarterChange),
  };
  const valuations = computeValuation(metrics, price);
  const qualityScore = computeQualityScore(metrics);
  const momentumScore = computeMomentumScore(price || prevClose, metrics);
  const priceChangeAbs = price && prevClose ? price - prevClose : 0;
  const priceChangePct = prevClose ? priceChangeAbs / prevClose : 0;
  const events = normaliseNews(news);
  const documents = deriveDocuments(news, entry.symbol);
  const history = buildHistory(fundamentals);
  const compositeScore = clamp((qualityScore * 0.55 + momentumScore * 0.25 + (valuations.upside * 100) * 0.2), 0, 100);
  return {
    symbol: entry.symbol,
    name: latest?.name || latest?.ticker || entry.symbol,
    exchange: entry.mic || latest?.exchangeCode || '',
    currency,
    price,
    priceChange: {
      absolute: priceChangeAbs,
      percent: priceChangePct,
    },
    valuations,
    qualityScore,
    momentumScore,
    dividendYield: percent(metrics.dividendYield) ?? 0,
    marketCapUsd: metrics.marketCap || 0,
    keyMetrics: formatKeyMetrics(metrics, valuations),
    metrics,
    history,
    events,
    documents,
    narrative: buildNarrative(entry.symbol, valuations, qualityScore, momentumScore, events),
    timestamp: new Date().toISOString(),
    compositeScore,
  };
}

function generateFallbackRecord(symbol, index = 0) {
  const basePrice = 120 + ((symbol.charCodeAt(0) || 65) % 25) * 2 + index * 3;
  const fairValue = basePrice * 1.12;
  const events = [
    { date: new Date(Date.now() + 14 * 86400000).toISOString(), type: 'Earnings', headline: `${symbol} quarterly earnings call`, summary: 'Consensus expects mid-single-digit revenue growth.', url: '' },
    { date: new Date(Date.now() + 42 * 86400000).toISOString(), type: 'Product launch', headline: `${symbol} flagship product roadmap`, summary: 'Management teased AI-driven refresh cycle.', url: '' },
  ];
  const documents = [
    { date: new Date(Date.now() - 120 * 86400000).toISOString(), type: 'SEC Filing', title: `${symbol} Form 10-K`, summary: 'Annual report covering fiscal performance and outlook.', url: 'https://www.sec.gov/' },
    { date: new Date(Date.now() - 30 * 86400000).toISOString(), type: 'Earnings transcript', title: `${symbol} Q&A transcript`, summary: 'Prepared remarks and analyst questions from latest call.', url: 'https://www.sec.gov/' },
  ];
  return {
    symbol,
    name: `${symbol} Holdings (sample)`,
    exchange: 'XNAS',
    currency: 'USD',
    price: Number(basePrice.toFixed(2)),
    priceChange: { absolute: 1.2, percent: 0.012 },
    valuations: {
      fairValue,
      rangeLow: fairValue * 0.9,
      rangeHigh: fairValue * 1.15,
      methodology: 'Illustrative hybrid model',
      upside: (fairValue - basePrice) / basePrice,
      signalLabel: 'Moderate upside',
      signalClass: 'ok',
    },
    qualityScore: 72,
    momentumScore: 64,
    dividendYield: 0.006,
    marketCapUsd: 2.4e11,
    keyMetrics: [
      { label: 'Market cap', value: '240.00B' },
      { label: 'Forward P/E', value: '21.4' },
      { label: 'PEG (est)', value: '1.4' },
      { label: 'Dividend yield', value: '0.60%' },
      { label: 'FCF / share', value: '5.60' },
      { label: 'Fair value range', value: `${(fairValue * 0.9).toFixed(2)} – ${(fairValue * 1.15).toFixed(2)}` },
    ],
    metrics: {
      pe: 24.1,
      forwardPe: 21.4,
      revenueGrowth: 0.09,
      eps: 5.8,
      dividendYield: 0.006,
      operatingMargin: 0.27,
      netMargin: 0.22,
      freeCashFlowPerShare: 5.6,
      returnOnEquity: 0.38,
      debtToEquity: 1.1,
      marketCap: 2.4e11,
      week52High: basePrice * 1.18,
      week52Low: basePrice * 0.78,
      monthChange: 0.015,
      quarterChange: 0.035,
    },
    history: [
      { period: 'FY23', revenueGrowth: 0.08, eps: 5.6, margin: 0.25, leverage: 1.1 },
      { period: 'FY22', revenueGrowth: 0.07, eps: 5.2, margin: 0.24, leverage: 1.0 },
    ],
    events,
    documents,
    narrative: `${symbol} sample profile. Configure TIINGO_KEY for live fundamentals.`,
    timestamp: new Date().toISOString(),
    compositeScore: 68,
  };
}

async function loadRecord(entry, token, quoteMap) {
  const warnings = [];
  const [fundamentalsResult, newsResult] = await Promise.allSettled([
    fetchFundamentals(entry.symbol, entry.mic, token),
    fetchNews(entry.symbol, token),
  ]);
  const fundamentals = fundamentalsResult.status === 'fulfilled' ? fundamentalsResult.value : [];
  const news = newsResult.status === 'fulfilled' ? newsResult.value : [];
  if (fundamentalsResult.status === 'rejected') warnings.push(`Fundamentals unavailable: ${fundamentalsResult.reason?.message || fundamentalsResult.reason}`);
  if (newsResult.status === 'rejected') warnings.push(`News unavailable: ${newsResult.reason?.message || newsResult.reason}`);
  const quote = quoteMap.get(entry.symbol.toUpperCase()) || null;
  const record = normaliseRecord(entry, fundamentals, quote, news);
  if (warnings.length) record.warning = warnings.join(' ');
  return record;
}

export default async function handleFundamentalsRequest(request) {
  const url = new URL(request.url);
  const symbolParam = url.searchParams.get('symbols') || url.searchParams.get('symbol') || 'AAPL';
  const exchangeParam = url.searchParams.get('exchange') || '';
  const entries = parseSymbols(symbolParam, exchangeParam);
  const token = getTiingoToken();
  if (!token) {
    return Response.json({
      data: entries.map((entry, idx) => generateFallbackRecord(entry.symbol || 'AAPL', idx)),
      warning: 'Tiingo API key missing. Showing illustrative fundamentals.',
      fallback: true,
    }, { headers: corsHeaders });
  }
  try {
    const quoteMap = await fetchQuotes(entries.map((item) => buildTiingoTicker(item.symbol, item.mic)), token).catch(() => new Map());
    const records = [];
    for (const entry of entries) {
      records.push(await loadRecord(entry, token, quoteMap));
    }
    return Response.json({ data: records }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({
      data: entries.map((entry, idx) => generateFallbackRecord(entry.symbol || 'AAPL', idx)),
      warning: `Tiingo fundamentals request failed: ${error.message}`,
      fallback: true,
    }, { headers: corsHeaders });
  }
}

export const handler = async (event) => {
  const rawQuery = event?.rawQuery ?? event?.rawQueryString ?? '';
  const path = event?.path || '/.netlify/functions/tiingo-fundamentals';
  const host = event?.headers?.host || 'example.org';
  const url = event?.rawUrl || `https://${host}${path}${rawQuery ? `?${rawQuery}` : ''}`;
  const method = event?.httpMethod || 'GET';
  const request = new Request(url, { method, headers: event?.headers || {} });
  const response = await handleFundamentalsRequest(request);
  const headers = {};
  response.headers.forEach((value, key) => { headers[key] = value; });
  return { statusCode: response.status, headers, body: await response.text() };
};

export const __testables = {
  parseSymbols,
  computeValuation,
  computeQualityScore,
  computeMomentumScore,
  generateFallbackRecord,
  normaliseRecord,
};
