const corsHeaders = { 'access-control-allow-origin': process.env.ALLOWED_ORIGIN || '*' };

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

const tidyNumber = (value, digits = 2) => {
  if (value == null || Number.isNaN(value)) return '—';
  return Number(value).toFixed(digits);
};

const percentText = (value, digits = 1) => {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`;
};

function buildSummaryLines(items = [], limit = 5) {
  return items
    .slice(0, limit)
    .map((item) => {
      const date = item.date ? new Date(item.date).toISOString().split('T')[0] : '—';
      return `- [${date}] ${item.type || 'Event'}: ${item.headline || item.title || item.summary || ''}`;
    })
    .join('\n');
}

function buildPrompt(payload = {}) {
  const mode = payload.mode || 'single-equity';
  const baseIntro = `You are ChatGPT 5, an institutional-grade equity research analyst plugged into Tiingo market data. Write in concise paragraphs, cite catalysts, highlight risks and conclude with a conviction-weighted fair value.`;
  if (mode === 'screen') {
    const lines = (payload.universe || []).map((row, idx) => `#${idx + 1} ${row.symbol} (${row.name || 'n/a'}) — spot ${tidyNumber(row.price)} ${row.currency || ''}, fair value ${tidyNumber(row.fairValue || row.price)} (${percentText(row.upside || 0)}), quality ${tidyNumber(row.qualityScore || 0, 0)}, momentum ${tidyNumber(row.momentumScore || 0, 0)}, yield ${percentText(row.dividendYield || 0, 1)}`).join('\n');
    return `${baseIntro}\n\nTask: Review a multi-asset screen, rank conviction, highlight catalysts and risk hedges.\n\nUniverse:\n${lines}\n\nScreening filters: min market cap ${payload.filters?.minCap || 0}m, max forward PE ${payload.filters?.maxPe || 'n/a'}, min dividend ${percentText(payload.filters?.minYield || 0)}.\n\nStructure output with sections: 1) Leadership picks, 2) Event map, 3) Risk controls, 4) Trade ideas.`;
  }

  const events = buildSummaryLines(payload.events || []);
  const documents = buildSummaryLines(payload.documents || []);
  const valuation = payload.valuations || {};
  const metrics = payload.metrics || {};
  return `${baseIntro}\n\nInstrument: ${payload.symbol} (${payload.name || 'Unknown'})\nCurrency: ${payload.currency || 'USD'}\nLast price: ${tidyNumber(payload.price)}\nFair value: ${tidyNumber(valuation.fairValue || payload.price)} (${percentText(valuation.upside || 0)})\nValuation band: ${tidyNumber(valuation.rangeLow || valuation.fairValue || payload.price)} – ${tidyNumber(valuation.rangeHigh || valuation.fairValue || payload.price)}\nQuality score: ${tidyNumber(payload.qualityScore || 0, 0)}\nMomentum score: ${tidyNumber(payload.momentumScore || 0, 0)}\nDividend yield: ${percentText(metrics.dividendYield || payload.dividendYield || 0, 1)}\nRevenue growth: ${percentText(metrics.revenueGrowth || 0, 1)}\nMargins: gross ${percentText(metrics.grossMargin || 0, 1)}, operating ${percentText(metrics.operatingMargin || 0, 1)}\nLeverage: debt/equity ${tidyNumber(metrics.debtToEquity || 0, 2)}\n\nKey events:\n${events || '- none logged'}\n\nKey documents:\n${documents || '- none logged'}\n\nNarrative cues: ${payload.narrative || 'n/a'}.\n\nDeliverable: One investment thesis paragraph, one valuation & scenario paragraph, one risk paragraph, and a closing recommendation with position sizing guidance.`;
}

function offlineInsight(payload = {}) {
  const mode = payload.mode || 'single-equity';
  if (mode === 'screen') {
    const rows = payload.universe || [];
    if (!rows.length) {
      return {
        content: 'AI playbook offline — provide tickers to receive a ranked roadmap.',
        model: 'chatgpt-5-offline',
        warning: 'OPENAI_API_KEY missing. Returning locally generated guidance.',
      };
    }
    const leaders = rows.slice(0, 3).map((row, idx) => `#${idx + 1} ${row.symbol} (${row.name || 'n/a'}) → upside ${percentText(row.upside || 0)}, quality ${tidyNumber(row.qualityScore || 0, 0)}, momentum ${tidyNumber(row.momentumScore || 0, 0)}.`).join('\n');
    const laggards = rows.slice(-2).map((row) => `${row.symbol}: monitor ${percentText(row.momentumScore / 100 || 0)} momentum drift and event risk.`).join('\n');
    return {
      content: `**Leadership picks**\n${leaders || 'Universe empty.'}\n\n**Catalyst radar**\n${buildSummaryLines(rows.flatMap((row) => row.events || []), 6) || 'Load earnings calendars to populate catalysts.'}\n\n**Risk posture**\n${laggards || 'No risk warnings flagged — diversify across factors.'}\n\n**Playbook**\nScale into top-ranked ideas over three tranches, hedge beta with index futures and revisit when new filings land.`,
      model: 'chatgpt-5-offline',
      warning: 'OPENAI_API_KEY missing. Returning locally generated guidance.',
    };
  }

  const upside = payload.valuations?.upside ?? 0;
  const bias = upside > 0.1 ? 'Bullish' : upside < -0.05 ? 'Defensive' : 'Neutral';
  const events = buildSummaryLines(payload.events || [], 4) || 'No upcoming events recorded.';
  const docs = buildSummaryLines(payload.documents || [], 4) || 'Recent filings not captured. Sync with EDGAR for depth.';
  return {
    content: `**View: ${bias}**\nSpot ${tidyNumber(payload.price)} vs fair ${tidyNumber(payload.valuations?.fairValue || payload.price)} (${percentText(upside)}). Quality score ${tidyNumber(payload.qualityScore || 0, 0)}, momentum ${tidyNumber(payload.momentumScore || 0, 0)}.\n\n**Catalysts**\n${events}\n\n**Document focus**\n${docs}\n\n**Positioning**\nAllocate sizing proportional to conviction, stagger entries around event risk and monitor leverage (${tidyNumber(payload.metrics?.debtToEquity || 0, 2)}x).`,
    model: 'chatgpt-5-offline',
    warning: 'OPENAI_API_KEY missing. Returning locally generated guidance.',
  };
}

async function callOpenAi(prompt, apiKey) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      input: prompt,
      max_output_tokens: 900,
      temperature: 0.3,
    }),
  });
  const text = await response.text();
  if (!text) throw new Error('Empty response from OpenAI');
  const data = JSON.parse(text);
  if (!response.ok) {
    const message = data?.error?.message || response.statusText || 'OpenAI request failed';
    throw new Error(message);
  }
  const content = data?.output?.[0]?.content?.map?.((segment) => segment?.text || '').join(' ').trim();
  return {
    content: content || 'OpenAI returned no content.',
    model: data?.model || DEFAULT_MODEL,
    usage: data?.usage || null,
  };
}

export default async function handleAiAnalyst(request) {
  if (request.method && request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }
  let payload = {};
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: 'invalid_json', detail: String(error) }, { status: 400, headers: corsHeaders });
  }

  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    return Response.json(offlineInsight(payload), { status: 200, headers: corsHeaders });
  }

  try {
    const prompt = buildPrompt(payload);
    const result = await callOpenAi(prompt, apiKey);
    return Response.json(result, { headers: corsHeaders });
  } catch (error) {
    const fallback = offlineInsight(payload);
    fallback.warning = `OpenAI call failed: ${error.message}`;
    return Response.json(fallback, { status: 200, headers: corsHeaders });
  }
}

export const handler = async (event) => {
  const body = event?.body || '{}';
  const request = new Request(event?.rawUrl || 'https://example.org/.netlify/functions/ai-analyst', {
    method: event?.httpMethod || 'POST',
    headers: event?.headers || {},
    body: event?.httpMethod === 'GET' ? undefined : body,
  });
  const response = await handleAiAnalyst(request);
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return { statusCode: response.status, headers, body: await response.text() };
};

export const __testables = { buildPrompt, offlineInsight };
