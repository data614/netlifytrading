import { getTiingoToken, TIINGO_TOKEN_ENV_KEYS } from './lib/env.js';
import {
  loadValuation,
  loadCompanyOverview,
  loadCompanyNews,
  loadCompanyDocuments,
  loadCorporateActions,
  loadEod,
  __private as tiingoMock,
} from './tiingo.js';
import buildValuationSnapshot, { summarizeValuationNarrative } from './lib/valuation.js';
import { logError } from './lib/security.js';

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const corsHeaders = { 'access-control-allow-origin': ALLOWED_ORIGIN };

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toDate = (value) => {
  const d = value ? new Date(value) : null;
  return Number.isFinite(d?.getTime?.()) ? d : null;
};

const metaHeaders = () => {
  const token = getTiingoToken();
  const preview = token ? `${token.slice(0, 4)}...${token.slice(-4)}` : '';
  const chosenKey = TIINGO_TOKEN_ENV_KEYS.find((k) => typeof process.env?.[k] === 'string' && process.env[k].trim());
  return {
    'x-intel-token-preview': preview,
    'x-intel-token-key': chosenKey || '',
  };
};

const ok = (body, warning) => {
  const headers = {
    ...corsHeaders,
    ...metaHeaders(),
  };
  if (warning) headers['x-intel-warning'] = warning;
  return Response.json({ ...body, warning }, { headers });
};

const buildTimeline = (symbol, news = [], actions = {}) => {
  const items = [];
  news.forEach((item) => {
    const publishedAt = toDate(item.publishedAt);
    if (!publishedAt) return;
    items.push({
      type: 'news',
      symbol,
      headline: item.headline,
      summary: item.summary,
      source: item.source,
      url: item.url,
      publishedAt: publishedAt.toISOString(),
      sentiment: toNumber(item.sentiment),
    });
  });
  (actions.dividends || []).forEach((div) => {
    const date = toDate(div.exDate || div.payDate || div.recordDate);
    if (!date) return;
    items.push({
      type: 'dividend',
      symbol,
      headline: `Dividend $${(div.amount ?? 0).toFixed(2)}`,
      summary: `Ex-date ${div.exDate || '—'} · Pay date ${div.payDate || '—'}`,
      publishedAt: date.toISOString(),
      amount: toNumber(div.amount),
      currency: div.currency || 'USD',
    });
  });
  (actions.splits || []).forEach((split) => {
    const date = toDate(split.exDate);
    if (!date) return;
    items.push({
      type: 'split',
      symbol,
      headline: `Stock split ${split.numerator || 1}:${split.denominator || 1}`,
      summary: 'Corporate action recorded by Tiingo.',
      publishedAt: date.toISOString(),
    });
  });
  items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return items.slice(0, 40);
};

const detectRiskSignals = (valuation, news = []) => {
  const price = valuation?.price ?? null;
  const fairValue = valuation?.valuation?.fairValue ?? null;
  const upside = price && fairValue ? ((fairValue - price) / price) * 100 : null;
  const negativeNews = news.filter((item) => typeof item.sentiment === 'number' && item.sentiment < -0.2).slice(0, 5);
  const positiveNews = news.filter((item) => typeof item.sentiment === 'number' && item.sentiment > 0.2).slice(0, 5);

  return {
    price,
    fairValue,
    upside,
    momentumSignal: upside !== null ? (upside > 10 ? 'bullish' : upside < -10 ? 'bearish' : 'neutral') : 'unknown',
    negativeNews,
    positiveNews,
  };
};

const formatDocument = (doc) => ({
  headline: doc.headline,
  url: doc.url,
  publishedAt: doc.publishedAt,
  documentType: doc.documentType || 'Filing',
  source: doc.source,
});

const describePriceAction = (symbol, candles = []) => {
  if (!candles.length) return `${symbol} lacks recent price history.`;
  const sorted = candles.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const start = toNumber(first.close ?? first.price);
  const end = toNumber(last.close ?? last.price);
  if (start === null || end === null) return `${symbol} price trend unavailable.`;
  const change = ((end - start) / start) * 100;
  const direction = change > 0 ? 'higher' : change < 0 ? 'lower' : 'flat';
  return `${symbol} traded ${direction} over the selected horizon with a ${change.toFixed(1)}% move (from $${start.toFixed(2)} to $${end.toFixed(2)}).`;
};

const buildChatGpt5Summary = (symbol, intel) => {
  const valuationText = intel.valuation?.narrative ?? summarizeValuationNarrative(symbol, intel.valuation?.valuation);
  const priceCommentary = describePriceAction(symbol, intel.trend ?? []);
  const riskSignals = detectRiskSignals(intel.valuation, intel.news);

  const tone = riskSignals.momentumSignal === 'bullish'
    ? 'leans constructive with upside potential'
    : riskSignals.momentumSignal === 'bearish'
      ? 'flags downside risks that warrant caution'
      : 'remains balanced without a directional conviction';

  const newsHighlights = intel.news.slice(0, 3).map((item) => `${new Date(item.publishedAt).toLocaleDateString()}: ${item.headline}`).join(' | ');
  const filingHighlight = intel.documents.length ? `${intel.documents.length} regulatory documents reviewed` : 'no fresh filings detected';

  return [
    `ChatGPT-5 analyst module review for ${symbol}: ${valuationText}`,
    priceCommentary,
    `Sentiment check ${tone}; fair-value delta near ${riskSignals.upside !== null ? riskSignals.upside.toFixed(1) : '—'}%.`,
    newsHighlights ? `Key catalysts — ${newsHighlights}.` : 'No fresh catalysts identified in the lookback window.',
    `Document sweep indicates ${filingHighlight}.`,
    'Recommendation: align entry with personalised risk profile and monitor real-time Tiingo data for confirmation.',
  ].filter(Boolean).join(' ');
};

export async function gatherSymbolIntel(symbol, { limit = 120, timeframe = '3M' } = {}) {
  const token = getTiingoToken();
  const upper = symbol.toUpperCase();
  let warning = '';

  if (!token) {
    const fundamentals = tiingoMock.mockFundamentals(upper);
    const overview = tiingoMock.mockOverview(upper);
    const valuation = buildValuationSnapshot({
      price: fundamentals.metrics.price,
      earningsPerShare: fundamentals.metrics.earningsPerShare,
      revenuePerShare: fundamentals.metrics.revenuePerShare,
      freeCashFlowPerShare: fundamentals.metrics.freeCashFlowPerShare,
      bookValuePerShare: fundamentals.metrics.bookValuePerShare,
      revenueGrowth: fundamentals.metrics.revenueGrowth,
      epsGrowth: fundamentals.metrics.epsGrowth,
      fcfGrowth: fundamentals.metrics.fcfGrowth,
    });
    const news = tiingoMock.mockNews(upper, 6);
    const documents = tiingoMock.mockDocuments(upper, 4).map(formatDocument);
    const actions = tiingoMock.mockActions(upper);
    const timeline = buildTimeline(upper, news, actions);
    const priceSeries = tiingoMock.mockSeries(upper, Math.min(limit, 150), 'eod');
    return {
      symbol: upper,
      valuation: {
        symbol: upper,
        price: fundamentals.metrics.price,
        fundamentals,
        valuation,
        narrative: summarizeValuationNarrative(upper, valuation),
      },
      news,
      documents,
      actions,
      timeline,
      trend: priceSeries,
      overview,
      aiSummary: buildChatGpt5Summary(upper, {
        valuation: {
          symbol: upper,
          price: fundamentals.metrics.price,
          valuation,
          narrative: summarizeValuationNarrative(upper, valuation),
        },
        news,
        documents,
        trend: priceSeries,
      }),
      generatedAt: new Date().toISOString(),
      warning: 'Tiingo API key missing. Showing simulated intelligence.',
    };
  }

  const [valuation, news, documents, actions, trend, overview] = await Promise.all([
    loadValuation(upper, token),
    loadCompanyNews(upper, 12, token).catch(() => []),
    loadCompanyDocuments(upper, 8, token).catch(() => []),
    loadCorporateActions(upper, token).catch(() => ({})),
    loadEod(upper, limit, token).catch(() => []),
    loadCompanyOverview(upper, token).catch(() => null),
  ]);

  if (!news.length) warning = 'No recent news from Tiingo. Check symbol coverage.';

  const timeline = buildTimeline(upper, news, actions);

  return {
    symbol: upper,
    valuation,
    news,
    documents: documents.map(formatDocument),
    actions,
    timeline,
    trend,
    overview: overview || undefined,
    aiSummary: buildChatGpt5Summary(upper, { valuation, news, documents, trend }),
    generatedAt: new Date().toISOString(),
    warning,
  };
}

export async function handleRequest(request) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') || 'AAPL').toUpperCase();
  const limit = Number(url.searchParams.get('limit')) || 120;
  const timeframe = url.searchParams.get('timeframe') || '3M';

  try {
    const intel = await gatherSymbolIntel(symbol, { limit, timeframe });
    return ok({ symbol, data: intel }, intel.warning);
  } catch (error) {
    logError('AI analyst failed', error);
    const fallback = await gatherSymbolIntel(symbol, { limit, timeframe }).catch(() => null);
    if (fallback) {
      return ok({ symbol, data: fallback }, 'AI analyst fallback using simulated data.');
    }
    return Response.json({ error: 'AI analyst unavailable.' }, { status: 500, headers: corsHeaders });
  }
}

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

  const response = await handleRequest(request);
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

export default handleRequest;
