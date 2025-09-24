import { getTiingoToken } from './lib/env.js';

const corsHeaders = { 'access-control-allow-origin': process.env.ALLOWED_ORIGIN || '*' };
const API_BASE = 'https://api.tiingo.com/';

const hoursAgo = (hours) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

const FALLBACK_EVENTS = [
  {
    id: 'sample-earnings',
    title: 'Earnings beat with resilient services growth',
    date: hoursAgo(12),
    type: 'Earnings',
    source: 'Tiingo',
    summary: 'Company delivered top-line and EPS upside versus consensus, driven by services and high-margin software.',
    impactScore: 4,
    highlights: 'Watch margin guidance and management commentary on demand elasticity.',
    url: 'https://www.tiingo.com/',
  },
  {
    id: 'sample-product',
    title: 'Next-gen product launch expands premium pricing umbrella',
    date: hoursAgo(30),
    type: 'Product',
    source: 'Tiingo',
    summary: 'New hardware platform integrates custom silicon and AI workflows, supporting ecosystem lock-in and higher ASPs.',
    impactScore: 3,
    highlights: 'Track preorder cadence and supply chain commentary for lead times.',
    url: 'https://www.tiingo.com/',
  },
  {
    id: 'sample-regulatory',
    title: 'Regulatory inquiry focused on platform billing practices',
    date: hoursAgo(48),
    type: 'Regulatory',
    source: 'Tiingo',
    summary: 'Regulators requested information on subscription bundling. No fines yet but sets the stage for oversight.',
    impactScore: 2,
    highlights: 'Assess potential revenue at risk and timeline for resolution.',
    url: 'https://www.tiingo.com/',
  },
];

const classifyEvent = (article) => {
  const title = `${article?.title || ''}`.toLowerCase();
  const tags = (article?.tags || []).map((tag) => `${tag}`.toLowerCase());
  if (title.includes('earnings') || tags.includes('earnings')) return 'Earnings';
  if (title.includes('guidance') || tags.includes('guidance')) return 'Guidance';
  if (title.includes('dividend') || tags.includes('dividend')) return 'Capital returns';
  if (title.includes('buyback') || tags.includes('buyback')) return 'Capital returns';
  if (title.includes('acquisition') || title.includes('merger')) return 'M&A';
  if (title.includes('product') || title.includes('launch')) return 'Product';
  if (title.includes('regulator') || title.includes('doj') || title.includes('antitrust')) return 'Regulatory';
  if (title.includes('downgrade') || title.includes('upgrade')) return 'Brokerage';
  return article?.categories?.[0] || 'News';
};

const sentimentScore = (value) => {
  if (value == null) return 3;
  if (value > 0.35) return 5;
  if (value > 0.1) return 4;
  if (value < -0.35) return 1;
  if (value < -0.1) return 2;
  return 3;
};

const toEvents = (articles = []) => articles.map((article) => ({
  id: article.id || article.url,
  title: article.title,
  date: article.publishedDate || article.updatedDate || article.createdDate || new Date().toISOString(),
  type: classifyEvent(article),
  source: article.source || article.provider || 'Tiingo',
  summary: article.description || article.summary || '',
  impactScore: sentimentScore(article.sentimentScore ?? article.sentiment),
  highlights: (article.tags || []).slice(0, 4).join(', '),
  url: article.url,
  tags: article.tags || [],
}));

async function fetchTiingo(path, params, token) {
  const url = new URL(path, API_BASE);
  url.searchParams.set('token', token);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, value);
  });
  const response = await fetch(url);
  const text = await response.text();
  let data = [];
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      if (!response.ok) throw new Error(`Tiingo ${response.status}: ${text.slice(0, 200)}`);
      throw error;
    }
  }
  if (!response.ok) {
    const detail = typeof data === 'object' && data !== null
      ? data.message || data.error || JSON.stringify(data)
      : text;
    throw new Error(`Tiingo ${response.status}: ${detail}`);
  }
  return data;
}

async function handle(request) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') || 'AAPL').toUpperCase();
  const limit = Number(url.searchParams.get('limit')) || 8;
  const token = getTiingoToken();
  if (!token) {
    return Response.json({ symbol, events: FALLBACK_EVENTS, warning: 'Tiingo API key missing — showing sample catalysts.', fallback: true }, { headers: corsHeaders });
  }
  try {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 3);
    const data = await fetchTiingo('/tiingo/news', {
      tickers: symbol,
      limit: String(Math.min(Math.max(limit, 1), 20)),
      sortBy: 'publishedDate',
      startDate: startDate.toISOString().slice(0, 10),
    }, token);
    const articles = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    if (!articles.length) {
      return Response.json({ symbol, events: FALLBACK_EVENTS, warning: 'No recent Tiingo events. Displaying curated samples.', fallback: true }, { headers: corsHeaders });
    }
    const events = toEvents(articles).slice(0, limit);
    return Response.json({ symbol, events, fetchedAt: new Date().toISOString() }, { headers: corsHeaders });
  } catch (error) {
    console.error('tiingo-events error', error);
    return Response.json({ symbol, events: FALLBACK_EVENTS, warning: 'Tiingo news unavailable — showing curated samples.', fallback: true, error: String(error) }, { headers: corsHeaders, status: 200 });
  }
}

export default handle;

export const handler = async (event) => {
  const rawQuery = event?.rawQuery ?? event?.rawQueryString ?? '';
  const path = event?.path || '/api/tiingo-events';
  const host = event?.headers?.host || 'example.org';
  const url = event?.rawUrl || `https://${host}${path}${rawQuery ? `?${rawQuery}` : ''}`;
  const method = event?.httpMethod || 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : event?.body;
  const request = new Request(url, { method, headers: event?.headers || {}, body });
  const response = await handle(request);
  const headers = {}; response.headers.forEach((value, key) => { headers[key] = value; });
  return { statusCode: response.status, headers, body: await response.text() };
};
