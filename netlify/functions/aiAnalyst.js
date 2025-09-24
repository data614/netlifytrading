const corsHeaders = { 'access-control-allow-origin': process.env.ALLOWED_ORIGIN || '*' };

const OPENAI_KEY_ALIASES = [
  'OPENAI_API_KEY',
  'OPENAI_KEY',
  'GPT5_API_KEY',
  'CHATGPT5_API_KEY',
  'AI_ANALYST_KEY',
];

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

function pickOpenAiKey() {
  for (const key of OPENAI_KEY_ALIASES) {
    const value = (process.env?.[key] || '').trim();
    if (value) return value;
  }
  return '';
}

async function readJsonBody(request) {
  try {
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch (err) {
    console.error('aiAnalyst invalid JSON body', err);
    throw new Error('Request body must be valid JSON.');
  }
}

function summariseIntel(intel) {
  if (!intel || typeof intel !== 'object') return 'No supplemental intelligence provided.';
  const snapshot = intel.snapshot || {};
  const valuations = intel.valuations || {};
  const events = Array.isArray(intel.events) ? intel.events.slice(0, 8) : [];
  const documents = Array.isArray(intel.documents) ? intel.documents.slice(0, 8) : [];

  return {
    snapshot: {
      sector: snapshot.sector || '',
      industry: snapshot.industry || '',
      country: snapshot.country || '',
      marketCap: snapshot.marketCap || null,
      revenueGrowth: snapshot.revenueGrowth || null,
      ebitMargin: snapshot.ebitMargin || snapshot.operatingMargin || null,
      returnOnEquity: snapshot.returnOnEquity || null,
      freeCashFlow: snapshot.freeCashFlow || null,
      netDebt: snapshot.netDebt || null,
      currency: snapshot.currency || 'USD',
    },
    valuations: {
      intrinsicValue: valuations.intrinsicValue || null,
      marginOfSafety: valuations.marginOfSafety || null,
      forwardPe: valuations.forwardPe || valuations.trailingPe || null,
      evToEbitda: valuations.evToEbitda || null,
      riskPremium: valuations.riskPremium || null,
    },
    events: events.map((event) => ({
      type: event.type || 'Event',
      headline: event.headline || '',
      summary: event.summary || '',
      publishedAt: event.publishedAt || '',
    })),
    documents: documents.map((doc) => ({
      category: doc.category || 'Document',
      title: doc.title || '',
      summary: doc.summary || '',
      publishedAt: doc.publishedAt || '',
    })),
  };
}

function buildPrompt(payload) {
  const intelSummary = summariseIntel(payload?.intel);
  const objectives = payload?.objectives?.focus || [];
  const directives = payload?.objectives?.directives || '';
  const symbol = payload?.symbol || 'Unknown';
  const timeframe = payload?.timeframe || '1Y';
  const priceSummary = payload?.priceSummary || {};

  return `You are ChatGPT-5, an elite equity analyst. Produce a decisive fair value view.
Requirements:
- Respond strictly in JSON with keys narrative, valuation, checklist, meta.
- Valuation must include fairValue (number), confidence (0-1), bias (Bullish/Bearish/Neutral), marginOfSafety (decimal), and catalysts (array of strings).
- Checklist must include at least five bullet points with signal rating (Positive/Neutral/Negative).
- Narrative should be concise paragraphs referencing catalysts, risks, and public filings when available.
- Assume Tiingo market data is authoritative.

Inputs:
Symbol: ${symbol}
Timeframe: ${timeframe}
Price: ${priceSummary.lastPrice ?? 'unknown'}
Objectives: ${objectives.join(', ') || 'standard valuation'}
Directives: ${directives || 'None'}
Intel: ${JSON.stringify(intelSummary)}
`;
}

function fallbackResponse(symbol) {
  return Response.json({
    analysis: `ChatGPT-5 staging mode: Provide an OPENAI_API_KEY to activate live valuations for ${symbol}. The current build ships with a qualitative template you can extend once the key is configured.`,
    valuation: {
      fairValue: null,
      confidence: 0.4,
      bias: 'Neutral',
      marginOfSafety: 0,
    },
    message: 'AI analyst operating with mock data. Configure OPENAI_API_KEY to enable live responses.',
    mock: true,
  }, { headers: corsHeaders });
}

function parseAiContent(content) {
  if (!content || typeof content !== 'string') return null;
  try {
    return JSON.parse(content);
  } catch (err) {
    console.warn('aiAnalyst response was not valid JSON', content);
    return { narrative: content };
  }
}

export default async function aiAnalyst(request) {
  if (request.method && request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  let payload = {};
  try {
    payload = await readJsonBody(request);
  } catch (err) {
    return Response.json({ error: 'invalid_body', detail: err.message }, { status: 400, headers: corsHeaders });
  }

  const apiKey = pickOpenAiKey();
  if (!apiKey) {
    return fallbackResponse(payload?.symbol || 'the selected company');
  }

  const prompt = buildPrompt(payload);
  const body = {
    model: DEFAULT_MODEL,
    temperature: 0.35,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'You are ChatGPT-5, a disciplined equity research analyst that writes institutional-grade briefs.',
      },
      { role: 'user', content: prompt },
    ],
  };

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    if (!response.ok) {
      console.error('aiAnalyst upstream error', response.status, text);
      throw new Error(`OpenAI responded with ${response.status}`);
    }

    let parsed = null;
    try {
      const parsedBody = JSON.parse(text);
      const content = parsedBody?.choices?.[0]?.message?.content;
      parsed = parseAiContent(content);
    } catch (err) {
      console.error('aiAnalyst: failed to parse response body', err);
    }

    const result = parsed || {};
    return Response.json({
      analysis: result.narrative || result.analysis || 'No analysis returned by ChatGPT-5.',
      valuation: result.valuation || {},
      checklist: result.checklist || [],
      message: result?.meta?.message || 'ChatGPT-5 valuation complete.',
      raw: result,
    }, { headers: corsHeaders });
  } catch (err) {
    console.error('aiAnalyst fatal error', err);
    return Response.json({
      error: 'ai_request_failed',
      detail: String(err),
      analysis: 'ChatGPT-5 could not be reached. Please try again later.',
      valuation: {},
    }, { status: 502, headers: corsHeaders });
  }
}

export const handler = async (event) => {
  const url = event?.rawUrl || `https://${event?.headers?.host || 'example.org'}${event?.path || '/api/aiAnalyst'}`;
  const request = new Request(url, { method: event?.httpMethod || 'POST', headers: event?.headers || {}, body: event?.body });
  const response = await aiAnalyst(request);
  const headers = {}; response.headers.forEach((value, key) => { headers[key] = value; });
  return { statusCode: response.status, headers, body: await response.text() };
};

