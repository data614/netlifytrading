import handleTiingoRequest from './tiingo.js';
import { summarizeValuationNarrative } from './lib/valuation.js';
import { getGeminiKeyDetail, getGeminiModel, generateGeminiContent } from './lib/gemini.js';
import { getCodexKeyDetail, getCodexModel, generateCodexContent } from './lib/codex.js';
import { getGrokKeyDetail, getGrokModel, generateGrokContent } from './lib/grok.js';
import {
  priceToEarnings,
  priceToSales,
  debtToEquity,
  freeCashFlowYield,
  netDebtToEBITDA,
  returnOnEquity,
  toQuantNumber,
} from '../../utils/quant-math.js';

const SYSTEM_PROMPT = "You are a senior equity research analyst. Based on the following financial data, news, and filings, provide a concise, single-paragraph investment thesis. Include key valuation metrics, potential risks, and a concluding sentence on the equity's outlook.";

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const corsHeaders = {
  'access-control-allow-origin': ALLOWED_ORIGIN,
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const DEFAULT_NEWS_LIMIT = 6;
const DEFAULT_DOCUMENT_LIMIT = 4;
const DEFAULT_PRICE_POINTS = 120;

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const fmtCurrency = (value) => {
  const num = toNumber(value);
  if (num === null) return 'n/a';
  return `$${num.toFixed(2)}`;
};

const fmtPercent = (value, fraction = false) => {
  const num = toNumber(value);
  if (num === null) return 'n/a';
  const pct = fraction ? num * 100 : num;
  return `${pct.toFixed(1)}%`;
};

const buildTiingoRequest = (symbol, { kind = 'eod', limit, interval } = {}) => {
  const params = new URLSearchParams({ symbol: symbol.toUpperCase() });
  if (kind) params.set('kind', kind);
  if (limit) params.set('limit', String(limit));
  if (interval) params.set('interval', String(interval));
  const url = `http://localhost/.netlify/functions/tiingo?${params.toString()}`;
  return new Request(url, { method: 'GET' });
};

const callTiingo = async (symbol, options) => {
  const request = buildTiingoRequest(symbol, options);
  const response = await handleTiingoRequest(request);
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  let body = null;
  try {
    body = await response.json();
  } catch (error) {
    const fallback = await response.text();
    body = { error: 'Non-JSON Tiingo response', raw: fallback.slice(0, 200) };
  }
  return {
    status: response.status,
    headers,
    body,
    warning: body?.warning || headers['x-tiingo-warning'] || '',
    meta: body?.meta || {},
  };
};

const summarizePriceHistory = (symbol, rows = []) => {
  if (!Array.isArray(rows) || !rows.length) {
    return `${symbol} price history unavailable.`;
  }
  const sorted = rows
    .slice()
    .filter((row) => row?.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!sorted.length) {
    return `${symbol} price history unavailable.`;
  }
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const start = toNumber(first.close ?? first.price ?? first.last);
  const end = toNumber(last.close ?? last.price ?? last.last);
  if (start === null || end === null || !first.date || !last.date) {
    return `${symbol} price history insufficient for analysis.`;
  }
  const change = ((end - start) / start) * 100;
  const direction = change > 0 ? 'advanced' : change < 0 ? 'declined' : 'was flat';
  return `${symbol} ${direction} ${change.toFixed(1)}% from ${new Date(first.date).toISOString().slice(0, 10)} (${fmtCurrency(start)}) to ${new Date(last.date).toISOString().slice(0, 10)} (${fmtCurrency(end)}).`;
};

const formatValuationSection = (symbol, valuationData) => {
  const valuation = valuationData?.valuation;
  if (!valuation) {
    return `Valuation snapshot unavailable for ${symbol}.`;
  }
  const growth = valuation?.growth || {};
  const scenarios = valuation?.scenarios || {};
  return [
    'Valuation Snapshot:',
    `- Last price: ${fmtCurrency(valuation?.price ?? valuationData?.price)}`,
    `- Fair value estimate: ${fmtCurrency(valuation?.fairValue)} (upside ${fmtPercent((valuation?.fairValue && valuation?.price) ? ((valuation.fairValue - valuation.price) / valuation.price) * 100 : null)})`,
    `- Suggested entry (margin of safety ${fmtPercent((valuation?.marginOfSafety || 0) * 100)}): ${fmtCurrency(valuation?.suggestedEntry)}`,
    `- Growth outlook: base ${fmtPercent(growth.base, true)} · bull ${fmtPercent(growth.bull, true)} · bear ${fmtPercent(growth.bear, true)}`,
    scenarios?.bull && scenarios?.bear
      ? `- Scenario targets: bull ${fmtCurrency(scenarios.bull)} · bear ${fmtCurrency(scenarios.bear)}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
};

const formatFundamentalSection = (fundamentals = {}) => {
  const metrics = fundamentals?.metrics || {};
  const latest = fundamentals?.latest || {};
  const lines = [
    'Key Fundamental Metrics:',
    `- Revenue per share: ${fmtCurrency(metrics.revenuePerShare)}`,
    `- EPS: ${fmtCurrency(metrics.earningsPerShare)}`,
    `- Free cash flow per share: ${fmtCurrency(metrics.freeCashFlowPerShare)}`,
    `- Book value per share: ${fmtCurrency(metrics.bookValuePerShare)}`,
    `- Revenue growth: ${fmtPercent(metrics.revenueGrowth, true)}`,
    `- EPS growth: ${fmtPercent(metrics.epsGrowth, true)}`,
    `- FCF growth: ${fmtPercent(metrics.fcfGrowth, true)}`,
  ];
  if (latest?.reportDate) {
    lines.push(`- Latest report date: ${latest.reportDate}`);
  }
  return lines.join('\n');
};

const formatNewsSection = (news = []) => {
  if (!Array.isArray(news) || news.length === 0) {
    return 'Recent News: No notable coverage in the lookback window.';
  }
  const lines = news.slice(0, DEFAULT_NEWS_LIMIT).map((item) => {
    const date = item?.publishedAt ? new Date(item.publishedAt).toISOString().slice(0, 10) : 'Unknown date';
    const sentiment = typeof item?.sentiment === 'number' ? `${(item.sentiment * 100).toFixed(0)}%` : 'n/a';
    return `- ${date} | ${item?.source || 'Unknown source'} | ${item?.headline || 'Headline unavailable'} (Sentiment ${sentiment}). ${item?.summary || ''}`.trim();
  });
  return ['Recent News Highlights:', ...lines].join('\n');
};

const formatDocumentSection = (documents = []) => {
  if (!Array.isArray(documents) || documents.length === 0) {
    return 'Recent Filings: None reported over the sampling period.';
  }
  const lines = documents.slice(0, DEFAULT_DOCUMENT_LIMIT).map((doc) => {
    const date = doc?.publishedAt ? new Date(doc.publishedAt).toISOString().slice(0, 10) : 'Unknown date';
    return `- ${date} | ${doc?.documentType || 'Filing'} | ${doc?.headline || 'Untitled document'} (${doc?.source || 'Unknown source'}).`;
  });
  return ['Recent Filings & Documents:', ...lines].join('\n');
};

const formatActionsSection = (actions = {}) => {
  const lines = [];
  if (Array.isArray(actions?.dividends) && actions.dividends.length) {
    const recent = actions.dividends.slice(0, 3).map((div) => {
      const date = div?.exDate || div?.payDate || 'Unknown date';
      return `${date}: ${fmtCurrency(div?.amount)} dividend (${div?.currency || 'USD'}).`;
    });
    lines.push('Dividend Activity:', ...recent.map((line) => `- ${line}`));
  }
  if (Array.isArray(actions?.splits) && actions.splits.length) {
    const recentSplits = actions.splits.slice(0, 2).map((split) => {
      const date = split?.exDate || 'Unknown date';
      return `${date}: ${split?.numerator || 1}:${split?.denominator || 1} split.`;
    });
    lines.push('Share Split Activity:', ...recentSplits.map((line) => `- ${line}`));
  }
  if (!lines.length) {
    return 'Corporate Actions: No recent dividends or splits disclosed.';
  }
  return lines.join('\n');
};

const computeQuantMetrics = (datasets = {}) => {
  const valuation = datasets?.valuation?.valuation || {};
  const fundamentals = datasets?.fundamentals || {};
  const metrics = fundamentals?.metrics || {};
  const latest = fundamentals?.latest || {};

  const priceSeries = Array.isArray(datasets?.priceHistory) ? datasets.priceHistory : [];
  const lastPricePoint = priceSeries.length ? priceSeries[priceSeries.length - 1] : {};
  const price = toQuantNumber(
    valuation?.price
      ?? datasets?.valuation?.price
      ?? metrics?.price
      ?? lastPricePoint?.close
      ?? lastPricePoint?.price
      ?? lastPricePoint?.last,
  );

  const eps = toQuantNumber(metrics?.earningsPerShare ?? valuation?.earningsPerShare);
  const revenuePerShare = toQuantNumber(metrics?.revenuePerShare ?? valuation?.revenuePerShare);
  const freeCashFlowPerShare = toQuantNumber(metrics?.freeCashFlowPerShare ?? valuation?.freeCashFlowPerShare);
  const netIncome = toQuantNumber(latest?.netIncome ?? valuation?.netIncome ?? metrics?.netIncome);
  const totalDebt = toQuantNumber(latest?.totalDebt ?? metrics?.totalDebt ?? valuation?.totalDebt);
  const netDebt = toQuantNumber(latest?.netDebt ?? valuation?.netDebt ?? metrics?.netDebt ?? totalDebt);
  const shareholdersEquity = toQuantNumber(
    latest?.shareholderEquity
      ?? latest?.totalEquity
      ?? valuation?.shareholderEquity
      ?? metrics?.shareholderEquity,
  );
  const ebitda = toQuantNumber(latest?.ebitda ?? valuation?.ebitda ?? metrics?.ebitda);

  return {
    priceToEarnings: priceToEarnings(price, eps),
    priceToSales: priceToSales(price, revenuePerShare),
    freeCashFlowYield: freeCashFlowYield(price, freeCashFlowPerShare),
    debtToEquity: debtToEquity(totalDebt, shareholdersEquity),
    netDebtToEBITDA: netDebtToEBITDA(netDebt, ebitda),
    returnOnEquity: returnOnEquity(netIncome, shareholdersEquity),
  };
};

const fmtMultiple = (value) => (typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}x` : 'n/a');
const fmtRatio = (value) => (typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : 'n/a');

const formatQuantSection = (metrics = {}) => {
  return [
    'Quantitative Ratios:',
    `- P/E: ${fmtMultiple(metrics.priceToEarnings)}`,
    `- P/S: ${fmtMultiple(metrics.priceToSales)}`,
    `- FCF Yield: ${typeof metrics.freeCashFlowYield === 'number' && Number.isFinite(metrics.freeCashFlowYield)
      ? `${(metrics.freeCashFlowYield * 100).toFixed(1)}%`
      : 'n/a'}`,
    `- Debt/Equity: ${fmtRatio(metrics.debtToEquity)}`,
    `- Net Debt/EBITDA: ${fmtRatio(metrics.netDebtToEBITDA)}`,
    `- Return on Equity: ${typeof metrics.returnOnEquity === 'number' && Number.isFinite(metrics.returnOnEquity)
      ? `${(metrics.returnOnEquity * 100).toFixed(1)}%`
      : 'n/a'}`,
  ].join('\n');
};

const buildUserPrompt = (symbol, datasets) => {
  const quantMetrics = datasets?.quantMetrics || computeQuantMetrics(datasets);
  const sections = [
    `Ticker: ${symbol}`,
    datasets.valuation ? formatValuationSection(symbol, datasets.valuation) : `Valuation snapshot unavailable for ${symbol}.`,
    datasets.fundamentals ? formatFundamentalSection(datasets.fundamentals) : 'Key Fundamental Metrics: unavailable.',
    formatQuantSection(quantMetrics),
    `Price Performance: ${summarizePriceHistory(symbol, datasets.priceHistory)}`,
    formatNewsSection(datasets.news),
    formatDocumentSection(datasets.documents),
    formatActionsSection(datasets.actions),
  ];
  if (datasets.warnings?.length) {
    sections.push(`Data Quality Flags: ${datasets.warnings.join(' | ')}`);
  }
  return sections.filter(Boolean).join('\n\n');
};

const mergeWarnings = (...messages) => messages.filter((msg) => typeof msg === 'string' && msg.trim()).map((msg) => msg.trim());

const gatherTiingoIntel = async (symbol, { newsLimit = DEFAULT_NEWS_LIMIT, documentLimit = DEFAULT_DOCUMENT_LIMIT, priceLimit = DEFAULT_PRICE_POINTS } = {}) => {
  const [valuationRes, newsRes, documentsRes, actionsRes, priceRes] = await Promise.all([
    callTiingo(symbol, { kind: 'valuation' }),
    callTiingo(symbol, { kind: 'news', limit: newsLimit }),
    callTiingo(symbol, { kind: 'documents', limit: documentLimit }),
    callTiingo(symbol, { kind: 'actions' }),
    callTiingo(symbol, { kind: 'eod', limit: priceLimit }),
  ]);

  const datasets = {
    valuation: valuationRes?.body?.data || null,
    fundamentals: valuationRes?.body?.data?.fundamentals || null,
    news: Array.isArray(newsRes?.body?.data) ? newsRes.body.data : [],
    documents: Array.isArray(documentsRes?.body?.data) ? documentsRes.body.data : [],
    actions: actionsRes?.body?.data || {},
    priceHistory: Array.isArray(priceRes?.body?.data) ? priceRes.body.data : [],
  };

  const quantMetrics = computeQuantMetrics(datasets);
  datasets.quantMetrics = quantMetrics;

  const warnings = mergeWarnings(
    valuationRes?.warning,
    newsRes?.warning,
    documentsRes?.warning,
    actionsRes?.warning,
    priceRes?.warning,
  );

  const responses = {
    valuation: valuationRes,
    news: newsRes,
    documents: documentsRes,
    actions: actionsRes,
    priceHistory: priceRes,
  };

  return { datasets, warnings, responses };
};

const ok = (body, warning) => {
  const headers = { ...corsHeaders };
  if (warning) {
    headers['x-ai-analyst-warning'] = warning;
  }
  return Response.json(body, { headers });
};

const handleOptions = () => new Response(null, { status: 204, headers: corsHeaders });

export async function handleRequest(request) {
  if (request.method === 'OPTIONS') return handleOptions();

  let symbol = 'AAPL';
  let newsLimit = DEFAULT_NEWS_LIMIT;
  let documentLimit = DEFAULT_DOCUMENT_LIMIT;
  let priceLimit = DEFAULT_PRICE_POINTS;

  if (request.method === 'GET') {
    const url = new URL(request.url);
    symbol = (url.searchParams.get('symbol') || symbol).toUpperCase();
    newsLimit = Number(url.searchParams.get('newsLimit')) || newsLimit;
    documentLimit = Number(url.searchParams.get('documentLimit')) || documentLimit;
    priceLimit = Number(url.searchParams.get('priceLimit')) || priceLimit;
  } else if (request.method === 'POST') {
    try {
      const payload = await request.json();
      if (payload?.symbol) symbol = String(payload.symbol).toUpperCase();
      if (payload?.newsLimit) newsLimit = Number(payload.newsLimit) || newsLimit;
      if (payload?.documentLimit) documentLimit = Number(payload.documentLimit) || documentLimit;
      if (payload?.priceLimit) priceLimit = Number(payload.priceLimit) || priceLimit;
    } catch (error) {
      return Response.json({ error: 'Invalid JSON payload.' }, { status: 400, headers: corsHeaders });
    }
  }

  try {
    const { datasets, warnings: tiingoWarnings, responses } = await gatherTiingoIntel(symbol, {
      newsLimit,
      documentLimit,
      priceLimit,
    });

    const userPrompt = buildUserPrompt(symbol, { ...datasets, warnings: tiingoWarnings });

    const geminiKeyDetail = getGeminiKeyDetail();
    const geminiKey = geminiKeyDetail.token;
    const geminiModel = getGeminiModel();

    let narrativeSource = 'chatgpt-codex';
    let narrativeText = '';
    let codexPayload = null;
    let grokPayload = null;
    let geminiPayload = null;
    let codexError = '';
    let grokError = '';
    let geminiError = '';

    const codexKeyDetail = getCodexKeyDetail();
    const codexKey = codexKeyDetail.token;
    const codexModel = getCodexModel();
    const grokKeyDetail = getGrokKeyDetail();
    const grokKey = grokKeyDetail.token;
    const grokModel = getGrokModel();

    if (codexKey) {
      try {
        const codexResult = await generateCodexContent({
          apiKey: codexKey,
          model: codexModel,
          systemPrompt: SYSTEM_PROMPT,
          userPrompt,
        });
        codexPayload = {
          model: codexResult.model,
          hasText: Boolean(codexResult.text),
        };
        narrativeText = codexResult.text?.trim() || '';
      } catch (error) {
        codexError = error?.message || 'ChatGPT Codex request failed.';
      }
    } else {
      codexError = 'ChatGPT Codex API key missing.';
    }

    if (!narrativeText) {
      narrativeSource = 'grok';
      if (grokKey) {
        try {
          const grokResult = await generateGrokContent({
            apiKey: grokKey,
            model: grokModel,
            systemPrompt: SYSTEM_PROMPT,
            userPrompt,
          });
          grokPayload = {
            model: grokResult.model,
            hasText: Boolean(grokResult.text),
          };
          narrativeText = grokResult.text?.trim() || '';
        } catch (error) {
          narrativeSource = 'gemini';
          grokError = error?.message || 'Grok request failed.';
        }
      } else {
        narrativeSource = 'gemini';
        grokError = 'Grok API key missing.';
      }
    }

    if (!narrativeText) {
      if (narrativeSource !== 'gemini') narrativeSource = 'gemini';
      if (geminiKey) {
        try {
          const result = await generateGeminiContent({
            apiKey: geminiKey,
            model: geminiModel,
            systemPrompt: SYSTEM_PROMPT,
            userPrompt,
          });
          narrativeText = result.text?.trim() || '';
          geminiPayload = {
            model: result.model,
            hasText: Boolean(result.text),
          };
        } catch (error) {
          narrativeSource = 'fallback';
          geminiError = error?.message || 'Gemini request failed.';
        }
      } else {
        narrativeSource = 'fallback';
        geminiError = 'Gemini API key missing.';
      }
    }

    if (narrativeSource === 'fallback' || !narrativeText) {
      const fallbackNarrative = datasets?.valuation?.narrative
        || summarizeValuationNarrative(symbol, datasets?.valuation?.valuation)
        || `${symbol} valuation narrative unavailable.`;
      narrativeText = fallbackNarrative;
    }

    const combinedWarnings = mergeWarnings(
      ...tiingoWarnings,
      codexError,
      grokError,
      geminiError,
    );

    const responseBody = {
      symbol,
      generatedAt: new Date().toISOString(),
      tiingo: {
        data: datasets,
        warnings: tiingoWarnings,
        responses: Object.fromEntries(
          Object.entries(responses).map(([key, value]) => [key, {
            status: value?.status,
            warning: value?.warning || '',
            meta: value?.meta || {},
            source: value?.headers?.['x-tiingo-source'] || value?.headers?.['x-intel-source'] || '',
          }]),
        ),
      },
      quant: datasets.quantMetrics,
      prompt: {
        system: SYSTEM_PROMPT,
        user: userPrompt,
      },
      narrative: {
        text: narrativeText,
        source: narrativeText && narrativeSource ? narrativeSource : 'fallback',
        codex: codexPayload,
        grok: grokPayload,
        gemini: geminiPayload,
        errors: {
          codex: codexError || undefined,
          grok: grokError || undefined,
          gemini: geminiError || undefined,
        },
      },
      warnings: combinedWarnings,
      gemini: {
        model: geminiModel,
        keyHint: geminiKeyDetail.key || '',
      },
      codex: {
        model: codexModel,
        keyHint: codexKeyDetail.key || '',
      },
      grok: {
        model: grokModel,
        keyHint: grokKeyDetail.key || '',
      },
    };

    return ok(responseBody, combinedWarnings.join(' | '));
  } catch (error) {
    console.error('AI analyst orchestrator failed:', error);
    return Response.json({ error: 'AI analyst orchestrator failed.' }, { status: 500, headers: corsHeaders });
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
