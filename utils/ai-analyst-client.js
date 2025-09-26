import { enrichError } from './frontend-errors.js';

const DEFAULT_ORIGIN = typeof window !== 'undefined' && window?.location?.origin
  ? window.location.origin
  : 'http://localhost';

function resolveFetch(fetchImpl) {
  if (typeof fetchImpl === 'function') return fetchImpl;
  if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
    return window.fetch.bind(window);
  }
  if (typeof fetch === 'function') {
    return fetch;
  }
  throw new Error('No fetch implementation available for AI Analyst client.');
}

export function buildAnalystUrl({ symbol, limit, timeframe, origin = DEFAULT_ORIGIN }) {
  if (!symbol) {
    throw new Error('Symbol is required to build AI Analyst request URL.');
  }
  const base = origin || DEFAULT_ORIGIN;
  const url = new URL('/.netlify/functions/ai-analyst', base);
  url.searchParams.set('symbol', symbol);
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
    url.searchParams.set('limit', Number(limit));
  }
  if (timeframe) {
    url.searchParams.set('timeframe', timeframe);
  }
  return url;
}

export async function fetchAnalystIntel({
  symbol,
  limit,
  timeframe,
  origin,
  signal,
  fetchImpl,
} = {}) {
  const ticker = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
  if (!ticker) {
    throw new Error('Symbol is required to request AI Analyst intelligence.');
  }

  const url = buildAnalystUrl({ symbol: ticker, limit, timeframe, origin });
  const fetchFn = resolveFetch(fetchImpl);

  try {
    const response = await fetchFn(url, {
      headers: { accept: 'application/json' },
      signal,
    });
    const contentType = (response.headers?.get?.('content-type') || '').toLowerCase();

    if (!response.ok) {
      let payload = null;
      let text = '';

      if (contentType.includes('application/json')) {
        payload = await response.json().catch(() => null);
      } else {
        text = await response.text().catch(() => '');
      }

      const rawMessage =
        payload?.error || payload?.message || payload?.detail || text || response.statusText;
      const error = new Error(rawMessage || 'AI Analyst request failed.');
      error.status = response.status;
      if (payload) {
        error.response = payload;
        error.detail = payload?.detail || payload?.error || payload?.message || '';
      } else if (text) {
        error.responseText = text;
      }
      throw error;
    }

    const body = await response.json();
    return body;
  } catch (error) {
    throw enrichError(error, {
      context: 'ai-analyst',
      fallback: 'AI Analyst is currently unavailable. Please try again shortly.',
    });
  }
}

export default fetchAnalystIntel;
