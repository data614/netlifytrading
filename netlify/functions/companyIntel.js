import { getTiingoToken } from './lib/env.js';

const corsHeaders = { 'access-control-allow-origin': process.env.ALLOWED_ORIGIN || '*' };
const API_BASE = 'https://api.tiingo.com/';
const DEFAULT_LIMIT = 200;

const fallbackIntel = {
  symbol: 'AAPL',
  snapshot: {
    currency: 'USD',
    sector: 'Technology',
    industry: 'Consumer Electronics',
    marketCap: 2.5e12,
    revenueGrowth: 0.08,
    ebitMargin: 0.29,
    freeCashFlow: 9.8e10,
    returnOnEquity: 0.52,
    netDebt: -5.5e10,
    country: 'United States',
  },
  valuations: {
    intrinsicValue: 215,
    marginOfSafety: 0.12,
    forwardPe: 21.3,
    evToEbitda: 17.6,
    riskPremium: 0.045,
    alphaOutlook: 'Moderate Outperform',
  },
  events: [
    {
      type: 'Earnings',
      headline: 'Apple posts resilient services growth despite hardware softness',
      summary: 'Services revenue reached a new high while iPhone sales softened against macro headwinds.',
      publishedAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
      url: 'https://example.com/earnings',
      tags: ['Earnings', 'Services'],
      severity: 'success',
    },
    {
      type: 'Regulation',
      headline: 'EU opens follow-on investigation into App Store payments',
      summary: 'Regulators are reviewing pricing policies for digital goods following DMA enforcement.',
      publishedAt: new Date(Date.now() - 32 * 24 * 60 * 60 * 1000).toISOString(),
      url: 'https://example.com/regulation',
      tags: ['Regulation', 'DMA'],
      severity: 'warning',
    },
  ],
  documents: [
    {
      title: 'Form 10-Q — Fiscal Q2 2025',
      category: 'SEC Filing',
      summary: 'Highlights resilience in subscription revenues and outlines share repurchase authorisation.',
      publishedAt: new Date(Date.now() - 26 * 24 * 60 * 60 * 1000).toISOString(),
      url: 'https://example.com/10q',
      tags: ['Filing', 'Financials'],
      impact: 'success',
    },
    {
      title: 'WWDC Keynote Recap',
      category: 'Corporate Event',
      summary: 'Introduced on-device AI roadmap and new developer incentives.',
      publishedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      url: 'https://example.com/wwdc',
      tags: ['Product', 'AI'],
      impact: 'success',
    },
  ],
  fetchedAt: new Date().toISOString(),
  source: 'fallback',
  warning: 'Tiingo API key missing. Showing curated sample intelligence.',
};

async function fetchTiingo(path, token, params = {}) {
  const url = new URL(path, API_BASE);
  url.searchParams.set('token', token);
  url.searchParams.set('limit', params.limit || DEFAULT_LIMIT);
  Object.entries(params).forEach(([key, value]) => {
    if (key === 'limit') return;
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, value);
  });
  const response = await fetch(url);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Tiingo ${response.status}: ${detail.slice(0, 200)}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function computeIntrinsicValue(snapshot, valuations) {
  if (valuations?.intrinsicValue) return Number(valuations.intrinsicValue);
  const earnings = toNumber(snapshot?.earningsPerShare) || toNumber(snapshot?.eps) || 0;
  const growth = snapshot?.revenueGrowth ?? 0.05;
  if (!earnings) return null;
  return Number((earnings * (1 + growth) * 15).toFixed(2));
}

function determineAlphaOutlook(marginOfSafety) {
  if (typeof marginOfSafety !== 'number') return 'Neutral';
  if (marginOfSafety > 0.2) return 'Strong Outperform';
  if (marginOfSafety > 0.1) return 'Moderate Outperform';
  if (marginOfSafety < -0.1) return 'Underperform';
  if (marginOfSafety < 0) return 'Hold';
  return 'Neutral';
}

function normaliseSnapshot(symbol, rows = []) {
  const latest = rows.at(-1) || rows[0] || {};
  const currency = latest?.currency || latest?.priceCurrency || latest?.quoteCurrency || 'USD';
  return {
    symbol,
    currency,
    sector: latest?.sector || latest?.sectorCode || '',
    industry: latest?.industry || latest?.industryCode || '',
    marketCap: toNumber(latest?.marketCap || latest?.marketcap),
    revenueGrowth: toNumber(latest?.revenueGrowth || latest?.revenueGrowth1Y || latest?.revenueGrowth3Y),
    ebitMargin: toNumber(latest?.ebitdaMargin || latest?.operatingMargin || latest?.netMargin),
    freeCashFlow: toNumber(latest?.freeCashFlow || latest?.freeCashFlowTTM),
    returnOnEquity: toNumber(latest?.returnOnEquity || latest?.roe),
    netDebt: toNumber(latest?.netDebt || latest?.totalDebt) || 0,
    currentRatio: toNumber(latest?.currentRatio),
    interestCoverage: toNumber(latest?.interestCoverage),
    country: latest?.country || latest?.countryCode || '',
    earningsPerShare: toNumber(latest?.eps || latest?.earningsPerShare),
    closePrice: toNumber(latest?.closePrice || latest?.adjClose || latest?.price),
  };
}

function normaliseValuations(snapshot, rows = []) {
  const latest = rows.at(-1) || rows[0] || {};
  const price = snapshot.closePrice || toNumber(latest?.closePrice) || null;
  const valuations = {
    trailingPe: toNumber(latest?.peRatio || latest?.trailingPERatio),
    forwardPe: toNumber(latest?.forwardPe || latest?.forwardPERatio),
    priceToSales: toNumber(latest?.priceToSales),
    evToEbitda: toNumber(latest?.evToEbitda || latest?.evToEbitdaRatio),
    riskPremium: toNumber(latest?.riskPremium || latest?.equityRiskPremium),
  };
  const intrinsic = computeIntrinsicValue(snapshot, valuations);
  if (intrinsic) valuations.intrinsicValue = intrinsic;
  if (intrinsic && price) {
    valuations.marginOfSafety = Number(((intrinsic - price) / price).toFixed(4));
  }
  valuations.alphaOutlook = determineAlphaOutlook(valuations.marginOfSafety);
  return valuations;
}

function mapNewsToEvents(news = []) {
  return news.map((item) => ({
    type: item?.categories?.[0] || item?.tags?.[0] || item?.source || 'News',
    headline: item?.title || '',
    summary: item?.description || '',
    url: item?.url || '',
    publishedAt: item?.publishedDate || item?.publishedUTC || item?.date || new Date().toISOString(),
    tags: item?.tags || [],
    severity: item?.sentimentScore != null
      ? item.sentimentScore > 0.2 ? 'success' : item.sentimentScore < -0.2 ? 'danger' : 'warning'
      : '',
  }));
}

function extractDocuments(news = []) {
  return news
    .filter((item) => (item?.tags || []).some((tag) => /filing|sec|transcript/i.test(tag)))
    .map((item) => ({
      title: item.title || '',
      category: (item.tags || []).find((tag) => /filing|sec/i.test(tag)) || 'Document',
      summary: item.description || '',
      url: item.url || '',
      publishedAt: item.publishedDate || item.date || new Date().toISOString(),
      tags: item.tags || [],
      impact: item.sentimentScore != null
        ? item.sentimentScore > 0.2 ? 'success' : item.sentimentScore < -0.2 ? 'danger' : 'warning'
        : '',
    }));
}

export default async function companyIntel(request) {
  if (request.method && request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase();
  const exchange = (url.searchParams.get('exchange') || '').trim();

  if (!symbol) {
    return Response.json({ error: 'missing_symbol', detail: 'Query parameter "symbol" is required.' }, { status: 400, headers: corsHeaders });
  }

  const token = getTiingoToken();
  if (!token) {
    return Response.json({ ...fallbackIntel, symbol, exchange, source: 'fallback' }, { headers: corsHeaders });
  }

  try {
    const [fundamentals, news] = await Promise.all([
      fetchTiingo(`/tiingo/fundamentals/${encodeURIComponent(symbol)}/daily`, token, { limit: DEFAULT_LIMIT }),
      fetchTiingo('/tiingo/news', token, { tickers: symbol, limit: 100 }),
    ]);

    const snapshot = normaliseSnapshot(symbol, Array.isArray(fundamentals) ? fundamentals : []);
    const valuations = normaliseValuations(snapshot, Array.isArray(fundamentals) ? fundamentals : []);
    const events = mapNewsToEvents(Array.isArray(news) ? news : []);
    const documents = extractDocuments(Array.isArray(news) ? news : []);

    return Response.json({
      symbol,
      exchange,
      snapshot,
      valuations,
      events,
      documents,
      fetchedAt: new Date().toISOString(),
      source: 'tiingo',
    }, { headers: corsHeaders });
  } catch (err) {
    console.error('companyIntel error', err);
    return Response.json({
      ...fallbackIntel,
      symbol,
      exchange,
      source: 'fallback',
      warning: 'Tiingo request failed. Returning cached intelligence.',
      detail: String(err),
    }, { headers: corsHeaders });
  }
}

export const handler = async (event) => {
  const path = event?.path || '/api/companyIntel';
  const host = event?.headers?.host || 'example.org';
  const rawQuery = event?.rawQuery || event?.rawQueryString || '';
  const url = event?.rawUrl || `https://${host}${path}${rawQuery ? `?${rawQuery}` : ''}`;
  const method = event?.httpMethod || 'GET';
  const request = new Request(url, { method, headers: event?.headers || {}, body: event?.body });
  const response = await companyIntel(request);
  const headers = {}; response.headers.forEach((value, key) => { headers[key] = value; });
  return { statusCode: response.status, headers, body: await response.text() };
};

