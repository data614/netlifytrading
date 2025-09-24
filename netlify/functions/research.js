import { getTiingoToken } from './lib/env.js';
import {
  resolveSymbolRequests,
  loadEod,
  loadIntradayLatest,
  generateMockSeries,
  inferCurrency,
  fetchTiingo,
} from './tiingo.js';

const corsHeaders = { 'access-control-allow-origin': process.env.ALLOWED_ORIGIN || '*' };

const SNAPSHOT_WINDOWS = {
  '1D': { label: '1 Day', lookback: 2 },
  '1W': { label: '1 Week', lookback: 6 },
  '1M': { label: '1 Month', lookback: 22 },
  '3M': { label: '3 Months', lookback: 66 },
  '6M': { label: '6 Months', lookback: 132 },
  '1Y': { label: '1 Year', lookback: 252 },
  '2Y': { label: '2 Years', lookback: 504 },
};

const FALLBACK_EVENTS = [
  {
    id: 'mock-earnings',
    title: 'Quarterly earnings beat consensus expectations',
    summary: 'Company reported resilient demand and margin expansion while reaffirming FY guidance.',
    url: '#',
    publishedAt: daysAgoIso(3),
    tags: ['Earnings', 'Guidance'],
  },
  {
    id: 'mock-dividend',
    title: 'Board approves strategic dividend increase',
    summary: 'Dividend lifted by 10% reflecting confidence in recurring cash flows and balance sheet strength.',
    url: '#',
    publishedAt: daysAgoIso(12),
    tags: ['Dividend'],
  },
  {
    id: 'mock-product',
    title: 'Flagship product refresh highlights AI roadmap',
    summary: 'Management highlighted accelerated integration of AI assistants across the product portfolio.',
    url: '#',
    publishedAt: daysAgoIso(18),
    tags: ['Product', 'AI'],
  },
];

const FALLBACK_FILINGS = [
  {
    id: 'mock-10q',
    formType: '10-Q',
    filedAt: daysAgoIso(25),
    description: 'Quarterly report detailing revenue growth of 11% and improving free cash flow.',
    url: '#',
  },
  {
    id: 'mock-8k',
    formType: '8-K',
    filedAt: daysAgoIso(14),
    description: 'Press release announcing a $5B accelerated share repurchase programme.',
    url: '#',
  },
  {
    id: 'mock-proxy',
    formType: 'DEF 14A',
    filedAt: daysAgoIso(40),
    description: 'Proxy statement summarising governance updates and board refresh.',
    url: '#',
  },
];

function daysAgoIso(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

const safeNumber = (value, fallback = null) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const sortByDate = (a, b) => {
  const da = new Date(a?.date || a?.publishedAt || 0).getTime();
  const db = new Date(b?.date || b?.publishedAt || 0).getTime();
  return da - db;
};

const roundTo = (value, digits = 2) => {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function computeSnapshots(series) {
  const ordered = [...series].filter((row) => row && row.date).sort(sortByDate);
  if (!ordered.length) return {};
  const latest = ordered[ordered.length - 1];
  const endPrice = safeNumber(latest.close ?? latest.price ?? latest.last, null);
  const out = {};
  Object.entries(SNAPSHOT_WINDOWS).forEach(([key, cfg]) => {
    const lookback = Math.max(Number(cfg.lookback) || 1, 1);
    const startIndex = Math.max(ordered.length - lookback, 1) - 1;
    const startRow = ordered[startIndex] || ordered[0];
    const startPrice = safeNumber(startRow.close ?? startRow.price ?? startRow.last, endPrice);
    const returnPct = startPrice && endPrice ? ((endPrice - startPrice) / startPrice) * 100 : null;
    const annualised = returnPct != null && lookback > 0 ? (returnPct / lookback) * 252 : null;
    out[key] = {
      label: cfg.label,
      startDate: startRow.date,
      endDate: latest.date,
      startPrice,
      endPrice,
      returnPct: returnPct != null ? roundTo(returnPct, 2) : null,
      annualizedReturn: annualised != null ? roundTo(annualised, 2) : null,
    };
  });
  return out;
}

function computeAverageVolume(series, span = 20) {
  const sliced = series.slice(-Math.max(span, 1));
  const volumes = sliced.map((row) => safeNumber(row.volume, null)).filter((value) => value != null);
  if (!volumes.length) return null;
  const sum = volumes.reduce((acc, value) => acc + value, 0);
  return Math.round(sum / volumes.length);
}

function computeVolatility(series) {
  const closes = series.map((row) => safeNumber(row.close ?? row.price ?? row.last, null)).filter((value) => value != null);
  if (closes.length < 3) return null;
  const returns = [];
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const curr = closes[i];
    if (prev && curr) returns.push(Math.log(curr / prev));
  }
  if (!returns.length) return null;
  const mean = returns.reduce((acc, value) => acc + value, 0) / returns.length;
  const variance = returns.reduce((acc, value) => acc + (value - mean) ** 2, 0) / returns.length;
  const dailyVol = Math.sqrt(Math.max(variance, 0));
  return dailyVol * Math.sqrt(252);
}

function computeMomentum(series, window = 20) {
  const closes = series.map((row) => safeNumber(row.close ?? row.price ?? row.last, null)).filter((value) => value != null);
  if (closes.length < window + 1) return null;
  const recent = closes[closes.length - 1];
  const past = closes[closes.length - 1 - window];
  if (!recent || !past) return null;
  return ((recent - past) / past) * 100;
}

function computeAtr(series, period = 14) {
  if (series.length < 2) return null;
  const trueRanges = [];
  for (let i = 1; i < series.length; i += 1) {
    const today = series[i];
    const prev = series[i - 1];
    const high = safeNumber(today.high ?? today.close, null);
    const low = safeNumber(today.low ?? today.close, null);
    const prevClose = safeNumber(prev.close ?? prev.last, null);
    if (high == null || low == null || prevClose == null) continue;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    if (Number.isFinite(tr)) trueRanges.push(tr);
  }
  if (!trueRanges.length) return null;
  const recent = trueRanges.slice(-Math.max(period, 1));
  const sum = recent.reduce((acc, value) => acc + value, 0);
  return sum / recent.length;
}

function evaluateRisk(volatility, momentum) {
  if (volatility == null) return { score: '—', label: 'Unavailable', conviction: 'Neutral' };
  const volScore = Math.min(100, Math.max(0, volatility * 100));
  const momentumScore = momentum != null ? Math.max(-50, Math.min(50, momentum / 2)) : 0;
  const composite = Math.max(0, Math.min(100, volScore - momentumScore));
  const label = composite > 70 ? 'High' : composite > 45 ? 'Elevated' : composite > 25 ? 'Moderate' : 'Low';
  const conviction = momentum != null && momentum > 5 && composite < 60 ? 'Positive' : momentum != null && momentum < -5 ? 'Cautious' : 'Neutral';
  return { score: roundTo(composite, 1), label, conviction };
}

function computeLevels(series) {
  if (!series.length) return {};
  const recent = series.slice(-30);
  const closes = recent.map((row) => safeNumber(row.close ?? row.price ?? row.last, null)).filter((value) => value != null);
  if (!closes.length) return {};
  const highs = recent.map((row) => safeNumber(row.high ?? row.close, null)).filter((value) => value != null);
  const lows = recent.map((row) => safeNumber(row.low ?? row.close, null)).filter((value) => value != null);
  const lastClose = closes[closes.length - 1];
  const immediateResistance = highs.length ? Math.max(...highs.slice(-10)) : null;
  const immediateSupport = lows.length ? Math.min(...lows.slice(-10)) : null;
  const majorResistance = highs.length ? Math.max(...highs) : null;
  const majorSupport = lows.length ? Math.min(...lows) : null;
  const pivot = lastClose && immediateResistance && immediateSupport
    ? (immediateResistance + immediateSupport + lastClose) / 3
    : lastClose;
  return {
    immediateSupport: immediateSupport != null ? roundTo(immediateSupport, 2) : null,
    immediateResistance: immediateResistance != null ? roundTo(immediateResistance, 2) : null,
    majorSupport: majorSupport != null ? roundTo(majorSupport, 2) : null,
    majorResistance: majorResistance != null ? roundTo(majorResistance, 2) : null,
    pivot: pivot != null ? roundTo(pivot, 2) : null,
  };
}

function buildScenarios(metrics) {
  const price = safeNumber(metrics.currentPrice, null);
  if (!price) return [];
  const high = safeNumber(metrics.fiftyTwoWeekHigh, price * 1.15);
  const low = safeNumber(metrics.fiftyTwoWeekLow, price * 0.85);
  const fairValue = safeNumber(metrics.fairValueEstimate, (high + low + price) / 3);
  const dailyVol = safeNumber(metrics.volatilityAnnualized, 0.35) / Math.sqrt(252);
  const bullPrice = roundTo(Math.min(high * 1.02, price * (1 + dailyVol * 8)), 2);
  const basePrice = roundTo(fairValue, 2);
  const bearPrice = roundTo(Math.max(low * 0.95, price * (1 - dailyVol * 6)), 2);
  const computeReturn = (target) => (target && price ? roundTo(((target - price) / price) * 100, 2) : null);
  return [
    {
      label: 'Bull',
      probability: 0.35,
      price: bullPrice,
      returnPct: computeReturn(bullPrice),
      commentary: 'Upside case assumes AI-driven demand and margin expansion sustain multiple premium.',
    },
    {
      label: 'Base',
      probability: 0.4,
      price: basePrice,
      returnPct: computeReturn(basePrice),
      commentary: 'Base case reflects reversion toward blended intrinsic value and seasonal trends.',
    },
    {
      label: 'Bear',
      probability: 0.25,
      price: bearPrice,
      returnPct: computeReturn(bearPrice),
      commentary: 'Downside case stresses macro slowdown and valuation compression toward long-term support.',
    },
  ];
}

function buildComparables(symbol, metrics, snapshots) {
  const price = safeNumber(metrics.currentPrice, null);
  const high = safeNumber(metrics.fiftyTwoWeekHigh, null);
  const low = safeNumber(metrics.fiftyTwoWeekLow, null);
  const peerBase = price && high && low ? (high + low + price) / 3 : price || 100;
  const momentum = snapshots?.['3M']?.returnPct ?? 0;
  const qualityNote = momentum > 5 ? 'Growth bias with improving momentum.' : momentum < -5 ? 'Defensive tilt amid slowing momentum.' : 'Balanced factor exposure with neutral momentum.';
  return [
    {
      name: `${symbol} Strategic Peer`,
      profile: 'Large-cap quality',
      fairValue: roundTo(peerBase * 1.05, 2),
      expectedReturn: roundTo((high && price) ? ((high - price) / price) * 100 : momentum / 2, 2),
      notes: qualityNote,
    },
    {
      name: `${symbol} Efficiency Cohort`,
      profile: 'Operational excellence',
      fairValue: roundTo(peerBase, 2),
      expectedReturn: roundTo(snapshots?.['6M']?.returnPct ?? 6, 2),
      notes: 'Peer basket emphasises free cash flow and cost discipline.',
    },
    {
      name: `${symbol} AI Beneficiary`,
      profile: 'AI & automation leverage',
      fairValue: roundTo(peerBase * 1.12, 2),
      expectedReturn: roundTo((snapshots?.['1Y']?.returnPct ?? 10) + 4, 2),
      notes: 'Captures optionality from AI enablement and platform scale.',
    },
  ];
}

function buildInsights(metrics, snapshots, events) {
  const insights = [];
  if (snapshots?.['1M']?.returnPct != null) {
    const monthly = snapshots['1M'].returnPct;
    if (monthly > 4) insights.push('Momentum is accelerating over the past month with a gain above 4%.');
    else if (monthly < -4) insights.push('One-month momentum is soft, highlighting a potential pullback opportunity.');
  }
  if (metrics.changePercent != null) {
    if (metrics.changePercent > 2) insights.push('Latest session delivered a >2% advance, signalling strong near-term demand.');
    if (metrics.changePercent < -2) insights.push('Latest session saw a meaningful pullback greater than 2%, monitor follow-through.');
  }
  if (metrics.fiftyTwoWeekHigh != null && metrics.currentPrice != null && metrics.fiftyTwoWeekHigh - metrics.currentPrice < (metrics.fiftyTwoWeekHigh - metrics.fiftyTwoWeekLow) * 0.1) {
    insights.push('Price is testing the upper end of the 52-week range; watch for breakout confirmation.');
  }
  if (metrics.volatilityAnnualized != null && metrics.volatilityAnnualized < 0.25) insights.push('Volatility remains contained (<25% annualised) enabling higher conviction position sizing.');
  if (Array.isArray(events) && events.length) {
    const first = events[0];
    if (first) insights.push(`Nearest catalyst: ${first.title || 'Event'} on ${new Date(first.publishedAt || first.date || Date.now()).toLocaleDateString()}.`);
  }
  if (!insights.length) insights.push('Awaiting additional data to surface automated insights.');
  return insights;
}

function computeMetrics(series, quote, request) {
  const ordered = [...series].filter((row) => row && row.date).sort(sortByDate);
  const latestRow = quote || ordered[ordered.length - 1] || {};
  const prevRow = ordered.length > 1 ? ordered[ordered.length - 2] : null;
  const currency = inferCurrency(latestRow, request?.mic) || 'USD';
  const currentPrice = safeNumber(latestRow.close ?? latestRow.price ?? latestRow.last, safeNumber(prevRow?.close, null));
  const previousClose = safeNumber(latestRow.previousClose ?? prevRow?.close ?? prevRow?.last, currentPrice);
  const change = currentPrice != null && previousClose != null ? currentPrice - previousClose : null;
  const changePercent = change != null && previousClose ? (change / previousClose) * 100 : null;
  const dayHigh = safeNumber(latestRow.high ?? latestRow.dayHigh ?? latestRow.close, null);
  const dayLow = safeNumber(latestRow.low ?? latestRow.dayLow ?? latestRow.close, null);
  const volume = safeNumber(latestRow.volume, safeNumber(prevRow?.volume, null));
  const averageVolume = computeAverageVolume(ordered);
  const high52 = Math.max(...ordered.map((row) => safeNumber(row.high ?? row.close, -Infinity)));
  const low52 = Math.min(...ordered.map((row) => safeNumber(row.low ?? row.close, Infinity)));
  const volatility = computeVolatility(ordered);
  const momentum = computeMomentum(ordered);
  const riskView = evaluateRisk(volatility, momentum);
  const fairValue = currentPrice != null && high52 !== -Infinity && low52 !== Infinity
    ? roundTo((currentPrice * 0.4) + ((high52 + low52) / 2) * 0.6, 2)
    : null;
  const expectedUpside = fairValue != null && currentPrice ? ((fairValue - currentPrice) / currentPrice) * 100 : null;
  const expectedDownside = low52 !== Infinity && currentPrice ? ((low52 * 0.95 - currentPrice) / currentPrice) * 100 : null;

  return {
    currency,
    currentPrice: currentPrice != null ? roundTo(currentPrice, 2) : null,
    previousClose: previousClose != null ? roundTo(previousClose, 2) : null,
    change: change != null ? roundTo(change, 2) : null,
    changePercent: changePercent != null ? roundTo(changePercent, 2) : null,
    dayHigh: dayHigh != null ? roundTo(dayHigh, 2) : null,
    dayLow: dayLow != null ? roundTo(dayLow, 2) : null,
    dayRange: dayHigh != null && dayLow != null ? `${roundTo(dayLow, 2)} – ${roundTo(dayHigh, 2)}` : '',
    volume,
    averageVolume,
    fiftyTwoWeekHigh: high52 !== -Infinity ? roundTo(high52, 2) : null,
    fiftyTwoWeekLow: low52 !== Infinity ? roundTo(low52, 2) : null,
    lastUpdated: latestRow.date || new Date().toISOString(),
    volatilityAnnualized: volatility != null ? roundTo(volatility, 3) : null,
    volatilityLabel: volatility != null ? `${roundTo(volatility * 100, 1)}%` : '—',
    momentumScore: momentum != null ? roundTo(momentum, 2) : null,
    momentumLabel: momentum != null ? `${roundTo(momentum, 1)}% / 20D` : '—',
    riskScore: riskView.score,
    riskLabel: riskView.label,
    conviction: riskView.conviction,
    fairValueEstimate: fairValue,
    expectedReturn: {
      upside: expectedUpside != null ? roundTo(expectedUpside, 2) : null,
      downside: expectedDownside != null ? roundTo(expectedDownside, 2) : null,
    },
  };
}

function computeRiskMetrics(series, metrics) {
  const price = safeNumber(metrics.currentPrice, null);
  const volatility = safeNumber(metrics.volatilityAnnualized, null);
  if (!price || !volatility) {
    return {
      note: 'Risk metrics rely on historical volatility; insufficient data for precise estimates.',
    };
  }
  const dailyVol = volatility / Math.sqrt(252);
  const var95 = price * dailyVol * 1.65;
  const var99 = price * dailyVol * 2.33;
  const expectedMove1D = price * dailyVol;
  const expectedMove1W = expectedMove1D * Math.sqrt(5);
  const expectedMove1M = expectedMove1D * Math.sqrt(21);
  const atr = computeAtr(series);
  const annualisedReturn = safeNumber(metrics.momentumScore, 0) / 100 * 252 / 20;
  const sharpeEstimate = volatility ? (annualisedReturn - 0.02) / volatility : null;
  return {
    var95: roundTo(var95, 2),
    var99: roundTo(var99, 2),
    expectedMove1D: roundTo(expectedMove1D, 2),
    expectedMove1W: roundTo(expectedMove1W, 2),
    expectedMove1M: roundTo(expectedMove1M, 2),
    beta: roundTo(1 + (volatility - 0.2) * 0.8, 2),
    atr: atr != null ? roundTo(atr, 2) : null,
    sharpeEstimate: sharpeEstimate != null ? roundTo(sharpeEstimate, 2) : null,
    note: 'Value at Risk approximations based on Tiingo-derived volatility; monitor during regime shifts.',
  };
}

function mapNewsToEvents(newsItems, symbol) {
  if (!Array.isArray(newsItems)) return [];
  return newsItems.slice(0, 20).map((item, idx) => ({
    id: item.id || item.url || `${symbol}-event-${idx}`,
    title: item.title || item.headline || 'Company Update',
    summary: item.description || item.summary || item.content || '',
    url: item.url || item.articleUrl || '',
    publishedAt: item.publishedDate || item.date || item.timestamp || new Date().toISOString(),
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 4) : (item.categories ? [].concat(item.categories).slice(0, 4) : []),
  }));
}

function mapFilings(rows, symbol) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 20).map((row, idx) => ({
    id: row.id || row.filingId || `${symbol}-filing-${idx}`,
    formType: row.formType || row.form || row.formCode || '—',
    filedAt: row.filingDate || row.filedDate || row.date || new Date().toISOString(),
    description: row.description || row.reportType || row.title || '',
    url: row.filingUrl || row.url || row.documentUrl || '',
  }));
}

function fallbackResearch(symbol, request) {
  const series = generateMockSeries(symbol, 260, 'eod');
  const snapshots = computeSnapshots(series);
  const metrics = computeMetrics(series, series[series.length - 1], request);
  const riskMetrics = computeRiskMetrics(series, metrics);
  const scenarios = buildScenarios(metrics);
  const levels = computeLevels(series);
  const comparables = buildComparables(symbol, metrics, snapshots);
  const insights = buildInsights(metrics, snapshots, FALLBACK_EVENTS);
  return {
    symbol,
    company: {
      name: `${symbol} Holdings (sample data)`,
      exchange: request?.mic || 'US',
      currency: metrics.currency,
      description: 'Sample data is displayed because a Tiingo API key is not configured. Replace with live credentials to unlock full coverage.',
    },
    metrics,
    snapshots,
    riskMetrics,
    levels,
    scenarios,
    comparables,
    events: FALLBACK_EVENTS,
    filings: FALLBACK_FILINGS,
    insights,
    warnings: ['Tiingo API key missing — displaying synthetic sample data.'],
    note: 'Activate TIINGO_API_KEY to access live pricing, events, and filings.',
  };
}

async function fetchProfile(request, token) {
  if (!token || !request?.ticker) return null;
  try {
    const path = `/tiingo/daily/${encodeURIComponent(request.ticker)}`;
    const data = await fetchTiingo(path, {}, token);
    if (data && typeof data === 'object') return data;
  } catch (error) {
    console.warn('profile fetch failed', error);
  }
  return null;
}

async function fetchNews(request, token, limit) {
  if (!token || !request?.ticker) return [];
  try {
    const params = { tickers: request.ticker, limit: String(limit), sortBy: 'publishedDate', order: 'desc' };
    const data = await fetchTiingo('/tiingo/news', params, token);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn('news fetch failed', error);
    return [];
  }
}

async function fetchFilings(request, token, limit) {
  if (!token || !request?.ticker) return [];
  try {
    const path = `/tiingo/sec/${encodeURIComponent(request.ticker)}`;
    const data = await fetchTiingo(path, { limit: String(limit) }, token);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn('filings fetch failed', error);
    return [];
  }
}

async function buildResearchPayload(symbol, request, token, options = {}) {
  const historyPoints = Math.max(Number(options.history) || 520, 120);
  const newsLimit = Math.max(Number(options.newsLimit) || 12, 3);
  const filingLimit = Math.max(Number(options.filingLimit) || 10, 3);

  const [history, profile, newsItems, filingsRaw] = await Promise.all([
    loadEod(request, historyPoints, token).catch((error) => {
      console.warn('price history fetch failed', error);
      return [];
    }),
    fetchProfile(request, token),
    fetchNews(request, token, newsLimit),
    fetchFilings(request, token, filingLimit),
  ]);

  let quote = null;
  try {
    const map = await loadIntradayLatest([request], token);
    quote = map.get(request.symbol) || null;
  } catch (error) {
    console.warn('real-time quote fetch failed', error);
  }

  const series = history.length ? history : generateMockSeries(symbol, 120, 'eod');
  const snapshots = computeSnapshots(series);
  const metrics = computeMetrics(series, quote, request);
  const riskMetrics = computeRiskMetrics(series, metrics);
  const levels = computeLevels(series);
  const scenarios = buildScenarios(metrics);
  const comparables = buildComparables(symbol, metrics, snapshots);
  const events = mapNewsToEvents(newsItems, symbol);
  const filings = mapFilings(filingsRaw, symbol);
  const insights = buildInsights(metrics, snapshots, events);

  const warnings = [];
  if (!history.length) warnings.push('Historical prices unavailable from Tiingo — using synthesised fallback series.');
  if (!newsItems.length) warnings.push('No recent Tiingo news articles were returned for this symbol.');
  if (!filingsRaw.length) warnings.push('No recent Tiingo SEC filings were returned for this symbol.');
  if (!quote) warnings.push('Real-time quote unavailable; using end-of-day prices.');

  return {
    symbol,
    company: {
      name: profile?.name || profile?.ticker || symbol,
      description: profile?.description || profile?.statement || '',
      exchange: profile?.exchangeCode || request?.mic || profile?.mic || '',
      sector: profile?.sector || '',
      industry: profile?.industry || '',
      website: profile?.url || profile?.website || '',
      currency: metrics.currency,
    },
    metrics,
    snapshots,
    riskMetrics,
    levels,
    scenarios,
    comparables,
    events: events.length ? events : FALLBACK_EVENTS,
    filings: filings.length ? filings : FALLBACK_FILINGS,
    insights,
    warnings,
    note: warnings.length ? 'Some datasets relied on fallbacks; review warnings for detail.' : '',
  };
}

export default async function handler(request) {
  if (request.method && request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const rawSymbol = url.searchParams.get('symbol') || 'AAPL';
  const exchange = url.searchParams.get('exchange') || '';
  const requests = resolveSymbolRequests(rawSymbol, exchange);
  const target = requests[0] || { symbol: (rawSymbol || 'AAPL').toUpperCase(), mic: '', ticker: rawSymbol };
  const symbol = target.symbol || (rawSymbol || 'AAPL').toUpperCase();

  const token = getTiingoToken();
  if (!token) {
    const fallback = fallbackResearch(symbol, target);
    return Response.json(fallback, { headers: corsHeaders });
  }

  try {
    const payload = await buildResearchPayload(symbol, target, token, {
      history: url.searchParams.get('history'),
      newsLimit: url.searchParams.get('newsLimit'),
      filingLimit: url.searchParams.get('filingLimit'),
    });
    return Response.json(payload, { headers: corsHeaders });
  } catch (error) {
    console.error('research handler failed', error);
    const fallback = fallbackResearch(symbol, target);
    fallback.warnings.push('Live Tiingo request failed; displaying sample intelligence.');
    fallback.note = 'Live Tiingo request failed; showing synthesised sample data.';
    return Response.json(fallback, { headers: corsHeaders });
  }
}

export { handler };
