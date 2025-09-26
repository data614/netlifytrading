import { gatherSymbolIntel } from './aiAnalyst.js';

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const corsHeaders = {
  'access-control-allow-origin': ALLOWED_ORIGIN,
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const MAX_SYMBOLS = 20;
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 6;
const MAX_LIMIT = 500;

const parseSymbols = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((value) => String(value || '').trim().toUpperCase())
      .filter((value, index, arr) => value && arr.indexOf(value) === index)
      .slice(0, MAX_SYMBOLS);
  }
  return String(raw)
    .split(/[\s,]+/)
    .map((value) => value.trim().toUpperCase())
    .filter((value, index, arr) => value && arr.indexOf(value) === index)
    .slice(0, MAX_SYMBOLS);
};

const handleOptions = () => new Response(null, { status: 204, headers: corsHeaders });

const computeSummary = (intel = {}) => {
  const symbol = intel.symbol || '';
  const valuation = intel.valuation || {};
  const valuationMetrics = valuation.valuation || valuation;
  const price = Number(valuation.price ?? valuationMetrics.price ?? null);
  const fairValue = Number(valuationMetrics.fairValue ?? null);
  let upside = Number(valuationMetrics.upside ?? null);
  if (!Number.isFinite(upside) && Number.isFinite(price) && Number.isFinite(fairValue) && price !== 0) {
    upside = ((fairValue - price) / price);
  }
  const growthBase = Number(valuationMetrics?.growth?.base ?? null);
  const marginOfSafety = Number(valuationMetrics?.marginOfSafety ?? null);
  const currency = intel.overview?.currency || valuation?.currency || 'USD';

  const metricEntries = [
    {
      key: 'growthBase',
      label: 'Base growth CAGR',
      value: Number.isFinite(growthBase) ? growthBase * 100 : null,
      unit: 'percent',
    },
    {
      key: 'marginOfSafety',
      label: 'Margin of safety',
      value: Number.isFinite(marginOfSafety) ? marginOfSafety * 100 : null,
      unit: 'percent',
    },
  ];

  return {
    symbol,
    price: Number.isFinite(price) ? price : null,
    currency,
    aiUpsidePct: Number.isFinite(upside) ? upside * 100 : null,
    metrics: metricEntries,
    metric1: metricEntries[0]?.value ?? null,
    metric2: metricEntries[1]?.value ?? null,
    generatedAt: intel.generatedAt || new Date().toISOString(),
  };
};

const normaliseMessage = (entry = {}) => {
  if (typeof entry === 'string') {
    return { symbol: '', message: entry };
  }
  const symbol = entry.symbol ? String(entry.symbol).toUpperCase() : '';
  const message = entry.message || entry.warning || entry.error || '';
  return message
    ? { symbol, message }
    : null;
};

const gatherInBatches = async (symbols, { limit, timeframe, concurrency = DEFAULT_CONCURRENCY } = {}) => {
  const upperLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.round(limit), MAX_LIMIT) : undefined;
  const safeTimeframe = timeframe ? String(timeframe).toUpperCase() : '3M';
  const workerCount = Math.max(1, Math.min(concurrency, MAX_CONCURRENCY, symbols.length));

  const results = new Array(symbols.length).fill(null);
  const warnings = [];
  const errors = [];
  let index = 0;

  const options = {};
  if (upperLimit) options.limit = upperLimit;
  if (safeTimeframe) options.timeframe = safeTimeframe;

  const worker = async () => {
    while (index < symbols.length) {
      const currentIndex = index;
      index += 1;
      const symbol = symbols[currentIndex];
      try {
        const intel = await gatherSymbolIntel(symbol, options);
        results[currentIndex] = computeSummary(intel);
        if (intel.warning) {
          const warningEntry = normaliseMessage({ symbol: intel.symbol || symbol, warning: intel.warning });
          if (warningEntry) warnings.push(warningEntry);
        }
      } catch (error) {
        console.error('Batch intel failed', symbol, error);
        const message = error?.message || 'Failed to load intelligence.';
        errors.push({ symbol, message });
        results[currentIndex] = { symbol, error: true, message };
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return { results: results.filter(Boolean), warnings, errors };
};

export async function handleRequest(request) {
  if (request.method === 'OPTIONS') return handleOptions();

  let symbols = [];
  let limit;
  let timeframe = '3M';
  let concurrency = DEFAULT_CONCURRENCY;

  if (request.method === 'GET') {
    const url = new URL(request.url);
    symbols = parseSymbols(url.searchParams.get('symbols'));
    const limitParam = Number(url.searchParams.get('limit'));
    if (Number.isFinite(limitParam) && limitParam > 0) limit = limitParam;
    const timeframeParam = url.searchParams.get('timeframe');
    if (timeframeParam) timeframe = timeframeParam;
    const concurrencyParam = Number(url.searchParams.get('concurrency'));
    if (Number.isFinite(concurrencyParam) && concurrencyParam > 0) concurrency = concurrencyParam;
  } else if (request.method === 'POST') {
    let payload = {};
    try {
      payload = await request.json();
    } catch (error) {
      return Response.json({ error: 'Invalid JSON payload.' }, { status: 400, headers: corsHeaders });
    }
    symbols = parseSymbols(payload.symbols || payload.tickers || []);
    const limitParam = Number(payload.limit ?? payload.priceLimit);
    if (Number.isFinite(limitParam) && limitParam > 0) limit = limitParam;
    if (payload.timeframe) timeframe = payload.timeframe;
    const concurrencyParam = Number(payload.concurrency);
    if (Number.isFinite(concurrencyParam) && concurrencyParam > 0) concurrency = concurrencyParam;
  } else {
    return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: corsHeaders });
  }

  if (!symbols.length) {
    return Response.json({ error: 'Provide one or more symbols via the "symbols" parameter.' }, {
      status: 400,
      headers: corsHeaders,
    });
  }

  try {
    const { results, warnings, errors } = await gatherInBatches(symbols, { limit, timeframe, concurrency });
    const successful = results.filter((row) => !row?.error);
    const responseBody = {
      requestedSymbols: symbols,
      results,
      warnings: warnings.map(normaliseMessage).filter(Boolean),
      errors: errors.map(normaliseMessage).filter(Boolean),
      meta: {
        count: successful.length,
        generatedAt: new Date().toISOString(),
        limit: Number.isFinite(limit) ? Math.min(Math.round(limit), MAX_LIMIT) : null,
        timeframe: timeframe ? String(timeframe).toUpperCase() : '3M',
      },
    };
    return Response.json(responseBody, { headers: corsHeaders });
  } catch (error) {
    console.error('Batch handler failed', error);
    return Response.json({ error: 'AI analyst batch request failed.' }, { status: 500, headers: corsHeaders });
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

  const responseBody = await response.text();

  return {
    statusCode: response.status,
    headers,
    body: responseBody,
  };
};

export default handleRequest;
