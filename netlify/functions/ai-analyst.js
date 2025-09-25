const corsHeaders = {
  'access-control-allow-origin': process.env.ALLOWED_ORIGIN || '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const OPENAI_URL = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = process.env.OPENAI_ANALYST_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const TARGET_MODEL = process.env.OPENAI_ANALYST_TARGET || 'gpt-5.0-preview';

const sanitizeList = (value, max = 6) => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map((item) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      const copy = { ...item };
      Object.keys(copy).forEach((key) => {
        if (copy[key] == null) delete copy[key];
      });
      return copy;
    }
    return item;
  });
};

const summarizeQuote = (quote) => {
  if (!quote || typeof quote !== 'object') return 'No real-time quote available.';
  const parts = [];
  if (quote.price != null) parts.push(`Last ${quote.price}`);
  if (quote.previousClose != null && quote.price != null && quote.previousClose !== 0) {
    const change = quote.price - quote.previousClose;
    const pct = quote.previousClose ? (change / quote.previousClose) * 100 : 0;
    const sign = change >= 0 ? '+' : '';
    parts.push(`Δ ${sign}${change.toFixed(2)} (${sign}${pct.toFixed(2)}%)`);
  }
  if (quote.volume != null) parts.push(`Volume ${quote.volume}`);
  if (quote.currency) parts.push(`Currency ${quote.currency}`);
  return parts.join(' · ');
};

const summarizeValuations = (valuations) => {
  if (!valuations || typeof valuations !== 'object') return 'No valuation model output.';
  const lines = [];
  if (valuations.blended?.fairValue != null) {
    lines.push(`Blended fair value ${valuations.blended.fairValue.toFixed(2)} (${(valuations.blended.confidence || 0) * 100}% confidence)`);
  }
  if (valuations.dcf?.fairValue != null) {
    const { fairValue, discountRate, terminalGrowth } = valuations.dcf;
    lines.push(`DCF ${fairValue.toFixed(2)} (discount ${discountRate ? (discountRate * 100).toFixed(1) : 'n/a'}%, terminal ${terminalGrowth ? (terminalGrowth * 100).toFixed(1) : 'n/a'}%)`);
  }
  if (valuations.multiples?.fairValue != null) {
    lines.push(`Multiples ${valuations.multiples.fairValue.toFixed(2)} (${valuations.multiples.notes || 'comps blend'})`);
  }
  return lines.join(' | ') || 'No valuation model output.';
};

const summarizeEvents = (events) => {
  if (!Array.isArray(events) || events.length === 0) return 'No curated events available.';
  return events.slice(0, 5).map((event, idx) => {
    const score = event.impactScore != null ? `impact ${event.impactScore}/5` : 'impact n/a';
    return `${idx + 1}. ${event.title || 'Event'} (${score}) — ${event.summary || ''}`;
  }).join('\n');
};

const clampText = (text = '', max = 6000) => (text.length > max ? `${text.slice(0, max)}…` : text);

const fallbackNarrative = (payload) => {
  const { symbol, universe, focus } = payload;
  return `AI analysis offline. Configure OPENAI_API_KEY to enable GPT-5 research.\n\nSymbol: ${symbol || 'n/a'}\nFocus: ${focus || 'balanced'}\nUniverse: ${universe || '—'}\n\nSuggested next steps:\n- Provide an OpenAI key and optional OPENAI_ANALYST_MODEL to target GPT-5 or enterprise models.\n- Re-run the screen to receive automated valuation notes, catalyst review, and risk scoring.`;
};

const buildPrompt = (payload) => {
  const mode = payload.mode || 'screener';
  const header = `You are GPT-5-class equity desk analyst embedded in a professional trading terminal. Deliver crisp, defensible insight with explicit valuation logic, risks, and actionable triggers.`;
  const quoteSummary = summarizeQuote(payload.quote);
  const valuationSummary = summarizeValuations(payload.valuations);
  const eventSummary = summarizeEvents(payload.events);
  const baseDetails = `Symbol: ${payload.symbol || 'n/a'}\nCurrent quote: ${quoteSummary}\nValuation snapshot: ${valuationSummary}\nMandate: ${payload.focus || 'balanced'} · Risk: ${payload.riskTolerance || 'balanced'} · Horizon: ${payload.horizon || 'medium'}\nUniverse candidates: ${payload.universe || 'n/a'}\nRecent events:\n${eventSummary}`;
  if (mode === 'document') {
    const documentExcerpt = clampText(payload.documentText || '', 5500);
    return `${header}\n\nTask: Review the following disclosure transcript or filing excerpt. Highlight material positives, negatives, accounting quirks, and follow-up questions. Finish with a verdict (Overweight/Market Weight/Underweight) and key catalysts.\n\n${baseDetails}\n\nDocument excerpt:\n"""\n${documentExcerpt}\n"""`;
  }
  return `${header}\n\nTask: Evaluate the listed universe and produce a ranked watchlist aligned with the mandate. Blend quantitative valuation with qualitative catalysts. Include: (1) thesis bullet(s), (2) valuation view with fair value range, (3) key catalysts & risks, (4) suggested positioning.\n\n${baseDetails}`;
};

const respond = (payload, init = {}) => Response.json(payload, { headers: corsHeaders, ...init });

async function handle(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return respond({ error: 'invalid_json', detail: 'Payload must be valid JSON.' }, { status: 400 });
  }

  const cleaned = {
    ...body,
    events: sanitizeList(body.events),
    valuations: body.valuations || null,
  };

  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || '';
  if (!apiKey) {
    return respond({
      analysis: fallbackNarrative(cleaned),
      model: 'offline-mock',
      fallback: true,
      warning: 'OPENAI_API_KEY missing — AI responses are mocked.',
    });
  }

  const prompt = buildPrompt(cleaned);
  try {
    const response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: 'system', content: 'You are a fiduciary-grade equity research assistant. Cite valuation logic, catalysts, and risk controls. Be concise but analytical.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.25,
        top_p: 0.9,
        max_tokens: 900,
        presence_penalty: 0,
        frequency_penalty: 0,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI error ${response.status}: ${text}`);
    }

    const payload = await response.json();
    const choice = payload?.choices?.[0]?.message?.content || '';
    return respond({
      analysis: choice,
      model: payload?.model || DEFAULT_MODEL,
      usage: payload?.usage || null,
      warning: TARGET_MODEL && TARGET_MODEL !== DEFAULT_MODEL
        ? `Request executed on ${DEFAULT_MODEL}. Set OPENAI_ANALYST_MODEL=${TARGET_MODEL} to target GPT-5 class when available.`
        : '',
    });
  } catch (error) {
    console.error('ai-analyst error', error);
    return respond({
      analysis: fallbackNarrative(cleaned),
      model: DEFAULT_MODEL,
      fallback: true,
      warning: 'AI request failed. Showing deterministic fallback.',
      error: String(error),
    }, { status: 200 });
  }
}

export default handle;

export const handler = async (event) => {
  const rawQuery = event?.rawQuery ?? event?.rawQueryString ?? '';
  const path = event?.path || '/api/ai-analyst';
  const host = event?.headers?.host || 'example.org';
  const url = event?.rawUrl || `https://${host}${path}${rawQuery ? `?${rawQuery}` : ''}`;
  const method = event?.httpMethod || 'POST';
  const body = method === 'GET' || method === 'HEAD' ? undefined : event?.body;
  const request = new Request(url, { method, headers: event?.headers || {}, body });
  const response = await handle(request);
  const headers = {}; response.headers.forEach((value, key) => { headers[key] = value; });
  return { statusCode: response.status, headers, body: await response.text() };
};
