import { getTiingoToken, TIINGO_TOKEN_ENV_KEYS } from './lib/env.js';
import { gatherSymbolIntel } from './aiAnalyst.js';

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const corsHeaders = { 'access-control-allow-origin': ALLOWED_ORIGIN };

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash-latest';
const GEMINI_ENDPOINT = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

const metaHeaders = () => {
  const token = getTiingoToken();
  const preview = token ? `${token.slice(0, 4)}...${token.slice(-4)}` : '';
  const chosenKey = TIINGO_TOKEN_ENV_KEYS.find((k) => typeof process.env?.[k] === 'string' && process.env[k].trim());
  const geminiPreview = GEMINI_API_KEY ? `${GEMINI_API_KEY.slice(0, 4)}...${GEMINI_API_KEY.slice(-4)}` : '';
  return {
    'x-intel-token-preview': preview,
    'x-intel-token-key': chosenKey || '',
    'x-gemini-model': GEMINI_MODEL,
    'x-gemini-key-preview': geminiPreview,
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

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function summarizeTrend(symbol, rows = []) {
  if (!Array.isArray(rows) || rows.length < 2) return `${symbol} price trend unavailable.`;
  const sorted = rows.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const start = toNumber(first.close ?? first.price);
  const end = toNumber(last.close ?? last.price);
  if (start === null || end === null) return `${symbol} price trend unavailable.`;
  const changePct = ((end - start) / start) * 100;
  const dir = changePct > 0 ? 'higher' : changePct < 0 ? 'lower' : 'flat';
  return `${symbol} traded ${dir} over the selected horizon with a ${changePct.toFixed(1)}% move (from $${start.toFixed(2)} to $${end.toFixed(2)}).`;
}

function buildGeminiPrompt(symbol, intel) {
  const s = symbol.toUpperCase();
  const v = intel?.valuation || {};
  const snap = v?.valuation || {};
  const metrics = v?.fundamentals?.metrics || intel?.valuation?.fundamentals?.metrics || {};
  const price = toNumber(v?.price ?? v?.quote?.price ?? snap?.price);
  const fair = toNumber(snap?.fairValue);
  const upside = price && fair ? ((fair - price) / price) * 100 : null;
  const entry = toNumber(snap?.suggestedEntry);
  const comps = snap?.components || {};

  const trendSummary = summarizeTrend(s, intel?.trend || []);

  const latestNews = (intel?.news || []).slice(0, 10).map((n) => ({
    date: n.publishedAt,
    headline: n.headline,
    sentiment: toNumber(n.sentiment),
    source: n.source,
    url: n.url,
    summary: n.summary,
  }));
  const latestDocs = (intel?.documents || []).slice(0, 6).map((d) => ({
    date: d.publishedAt,
    type: d.documentType || 'Filing',
    headline: d.headline,
    url: d.url,
  }));

  const fundamentalsSummary = {
    earningsPerShare: toNumber(metrics.earningsPerShare),
    revenuePerShare: toNumber(metrics.revenuePerShare),
    freeCashFlowPerShare: toNumber(metrics.freeCashFlowPerShare),
    bookValuePerShare: toNumber(metrics.bookValuePerShare),
    revenueGrowth: toNumber(metrics.revenueGrowth),
    epsGrowth: toNumber(metrics.epsGrowth),
    fcfGrowth: toNumber(metrics.fcfGrowth),
  };

  const valuationSummary = {
    price,
    fairValue: fair,
    upsidePct: Number.isFinite(upside) ? Number(upside.toFixed(2)) : null,
    suggestedEntry: entry,
    components: comps,
  };

  const dataBlock = JSON.stringify(
    {
      company: s,
      trendSummary,
      valuation: valuationSummary,
      fundamentals: fundamentalsSummary,
      news: latestNews,
      filings: latestDocs,
    },
    null,
    2,
  );

  const systemPrompt =
    'You are a senior equity research analyst. Based on the following financial data, news, and filings, provide a concise, single-paragraph investment thesis. Include key valuation metrics, potential risks, and a concluding sentence on the equity\'s outlook.';

  const userPrompt = [
    `${systemPrompt}`,
    '',
    'Guidelines:',
    '- Use one paragraph (5–7 sentences).',
    '- Mention current price, estimated fair value, and upside/downsides.',
    '- Highlight 1–2 drivers from fundamentals (EPS/revenue/FCF growth).',
    '- Incorporate notable news/filings if relevant.',
    '- State 1–2 key risks.',
    '- End with a clear outlook sentence (e.g., Maintain/Accumulate/Hold/Cautious).',
    '',
    'Data:',
    dataBlock,
  ].join('\n');

  return userPrompt;
}

async function callGemini({ model = GEMINI_MODEL, apiKey = GEMINI_API_KEY, prompt }) {
  if (!apiKey) return { text: '', model, note: 'GEMINI_API_KEY missing; skipping call.' };

  const url = `${GEMINI_ENDPOINT(model)}?key=${encodeURIComponent(apiKey)}`;
  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: String(prompt || '').slice(0, 30000) }],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 480,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const bad = await res.text().catch(() => '');
    throw new Error(`Gemini error ${res.status}: ${bad || res.statusText}`);
  }

  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p?.text || '')?.join(' ')?.trim() || '';
  return { text, model, raw: json };
}

export async function handleRequest(request) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') || 'AAPL').toUpperCase();
  const limit = Number(url.searchParams.get('limit')) || 120;
  const timeframe = url.searchParams.get('timeframe') || '3M';

  try {
    // Aggregate Tiingo-driven intelligence
    const intel = await gatherSymbolIntel(symbol, { limit, timeframe });

    // Build prompt and call Gemini
    const prompt = buildGeminiPrompt(symbol, intel);
    let narrative = '';
    let modelInfo = GEMINI_MODEL;
    let warning = intel?.warning || '';
    let geminiRaw;

    try {
      const result = await callGemini({ prompt });
      narrative = result.text || '';
      modelInfo = result.model || modelInfo;
      geminiRaw = result.raw;
      if (!narrative) warning = `${warning ? `${warning} ` : ''}Gemini returned empty content.`.trim();
    } catch (err) {
      console.error('Gemini generateContent failed:', err);
      // Graceful fallback to the local summary
      narrative = intel?.aiSummary || intel?.valuation?.narrative || '';
      warning = `${warning ? `${warning} ` : ''}Gemini call failed; used fallback narrative.`.trim();
    }

    return ok(
      {
        symbol,
        data: {
          ...intel,
          prompt,
          aiNarrative: narrative,
          aiModel: modelInfo,
          aiProvider: 'gemini',
          aiTimestamp: new Date().toISOString(),
          aiMeta: geminiRaw ? { promptFeedback: geminiRaw.promptFeedback, safetyRatings: geminiRaw.candidates?.[0]?.safetyRatings } : undefined,
        },
      },
      warning,
    );
  } catch (error) {
    console.error('AI Analyst orchestrator failed:', error);
    return Response.json(
      { error: 'AI analyst unavailable.' },
      { status: 500, headers: { ...corsHeaders, ...metaHeaders() } },
    );
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
