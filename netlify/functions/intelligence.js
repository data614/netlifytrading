const corsHeaders = { 'access-control-allow-origin': process.env.ALLOWED_ORIGIN || '*' };
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const CHATGPT5_MODEL = process.env.CHATGPT5_MODEL || DEFAULT_MODEL;

const MODEL_ALIASES = {
  'chatgpt-5': CHATGPT5_MODEL,
  'gpt-5': CHATGPT5_MODEL,
  'gpt5': CHATGPT5_MODEL,
};

const safeNumber = (value, fallback = null) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const clamp = (value, min, max) => {
  const num = safeNumber(value, null);
  if (num == null) return null;
  return Math.min(Math.max(num, min), max);
};

const percent = (value) => (value != null ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%` : '—');

function resolveModel(requested) {
  if (!requested) return CHATGPT5_MODEL;
  const key = String(requested).trim().toLowerCase();
  if (MODEL_ALIASES[key]) return MODEL_ALIASES[key];
  return requested;
}

function summariseEvents(events = []) {
  if (!events.length) return '';
  const highlights = events.slice(0, 2).map((event) => `${event.title || 'Catalyst'} (${new Date(event.publishedAt || event.date || Date.now()).toLocaleDateString()})`);
  return highlights.join('; ');
}

function normalisePeerSignals(list, currency) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 6).map((item, idx) => ({
    name: item.name || item.symbol || `Peer ${idx + 1}`,
    profile: item.profile || '',
    fairValue: safeNumber(item.fairValue, null),
    expectedReturn: safeNumber(item.expectedReturn, null),
    notes: item.notes || '',
    currency: item.currency || currency,
  }));
}

function buildHeuristicValuation(payload) {
  const symbol = String(payload.symbol || 'AAPL').toUpperCase();
  const metrics = payload.metrics || {};
  const snapshots = payload.snapshots || {};
  const events = Array.isArray(payload.events) ? payload.events : [];
  const comparables = normalisePeerSignals(payload.comparables || [], metrics.currency || 'USD');
  const currency = metrics.currency || 'USD';
  const currentPrice = safeNumber(metrics.currentPrice, safeNumber(metrics.previousClose, 100));
  const rangeHigh = safeNumber(metrics.fiftyTwoWeekHigh, currentPrice * 1.18);
  const rangeLow = safeNumber(metrics.fiftyTwoWeekLow, currentPrice * 0.82);
  const fairValueEstimate = safeNumber(metrics.fairValueEstimate, (rangeHigh + rangeLow + currentPrice) / 3);
  const fairValue = {
    base: fairValueEstimate != null ? Number(fairValueEstimate.toFixed(2)) : currentPrice,
    rangeHigh: rangeHigh != null ? Number((rangeHigh * 1.02).toFixed(2)) : null,
    rangeLow: rangeLow != null ? Number((rangeLow * 0.98).toFixed(2)) : null,
    currency,
  };
  const upside = currentPrice && fairValue.rangeHigh ? ((fairValue.rangeHigh - currentPrice) / currentPrice) * 100 : null;
  const downside = currentPrice && fairValue.rangeLow ? ((fairValue.rangeLow - currentPrice) / currentPrice) * 100 : null;
  const momentum = safeNumber(snapshots?.['3M']?.returnPct, null);
  const riskLabel = metrics.riskLabel || 'Moderate';
  const conviction = metrics.conviction || (momentum != null && momentum > 4 && riskLabel !== 'High' ? 'Constructive' : 'Neutral');
  const summaryParts = [
    `${symbol} trades near ${currency} ${currentPrice?.toFixed(2) ?? '—'} with ${riskLabel.toLowerCase()} risk conditions.`,
  ];
  if (fairValue.base != null && currentPrice != null) {
    const implied = ((fairValue.base - currentPrice) / currentPrice) * 100;
    summaryParts.push(`Deterministic fair value: ${currency} ${fairValue.base.toFixed(2)} (${percent(implied)} vs. spot).`);
  }
  const eventSummary = summariseEvents(events);
  if (eventSummary) summaryParts.push(`Key catalysts: ${eventSummary}.`);
  const drivers = [];
  if (momentum != null) {
    drivers.push(momentum > 0 ? `Positive ${snapshots['3M'].label || '3M'} momentum at ${percent(momentum)}.` : `Negative medium-term momentum at ${percent(momentum)}.`);
  }
  if (metrics.averageVolume) drivers.push(`Liquidity remains robust with average volume ${metrics.averageVolume.toLocaleString()}.`);
  if (metrics.expectedReturn?.upside != null) drivers.push(`Heuristic upside to fair value: ${percent(metrics.expectedReturn.upside)}.`);
  const risks = [];
  if (riskLabel === 'High') risks.push('Elevated volatility profile warrants staggered sizing.');
  if (metrics.expectedReturn?.downside != null) risks.push(`Downside to stress level: ${percent(metrics.expectedReturn.downside)}.`);
  if (!risks.length) risks.push('Monitor macro sensitivity and execution of roadmap.');
  const scenario = (label, probability, target) => ({
    label,
    probability,
    price: target != null ? Number(target.toFixed(2)) : null,
    returnPct: currentPrice && target != null ? Number((((target - currentPrice) / currentPrice) * 100).toFixed(2)) : null,
    commentary: label === 'Bull'
      ? 'Assumes continued share gains and AI monetisation driving multiple expansion.'
      : label === 'Bear'
        ? 'Models macro slowdown with valuation compressing toward structural support.'
        : 'Reverts to blended intrinsic value with stable execution.',
  });
  const scenarios = payload.scenarios && payload.scenarios.length
    ? payload.scenarios
    : [
      scenario('Bull', 0.35, fairValue.rangeHigh ?? fairValue.base * 1.1),
      scenario('Base', 0.4, fairValue.base),
      scenario('Bear', 0.25, fairValue.rangeLow ?? fairValue.base * 0.9),
    ];
  return {
    symbol,
    model: {
      requested: payload.model || 'heuristic',
      resolved: 'heuristic-v1',
      provider: 'heuristic',
    },
    generatedAt: new Date().toISOString(),
    summary: summaryParts.join(' '),
    fairValue,
    expectedReturn: {
      upside: upside != null ? Number(upside.toFixed(2)) : null,
      downside: downside != null ? Number(downside.toFixed(2)) : null,
    },
    conviction,
    drivers,
    risks,
    scenarios,
    recommendation: {
      text: fairValue.base != null && currentPrice
        ? fairValue.base > currentPrice
          ? 'Bias to accumulate on weakness with sizing framed by VaR constraints.'
          : 'Hold / trim rallies as price exceeds deterministic fair value.'
        : 'Maintain neutral stance pending additional price confirmation.',
    },
    note: 'Generated via deterministic heuristic because ChatGPT 5 access was unavailable.',
    peerSignals: comparables,
  };
}

async function callOpenAi(payload, resolvedModel) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');
  const systemPrompt = 'You are ChatGPT 5, an institutional equity research analyst. Respond ONLY with strict JSON matching the provided schema.';
  const schema = {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      fairValue: {
        type: 'object',
        properties: {
          base: { type: 'number' },
          rangeHigh: { type: 'number' },
          rangeLow: { type: 'number' },
          currency: { type: 'string' },
        },
        required: ['base'],
      },
      expectedReturn: {
        type: 'object',
        properties: {
          upside: { type: 'number' },
          downside: { type: 'number' },
        },
      },
      conviction: { type: 'string' },
      drivers: { type: 'array', items: { type: 'string' } },
      risks: { type: 'array', items: { type: 'string' } },
      scenarios: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            probability: { type: 'number' },
            price: { type: 'number' },
            returnPct: { type: 'number' },
            commentary: { type: 'string' },
          },
        },
      },
      recommendation: {
        type: 'object',
        properties: {
          text: { type: 'string' },
        },
      },
      note: { type: 'string' },
      peerSignals: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            profile: { type: 'string' },
            fairValue: { type: 'number' },
            expectedReturn: { type: 'number' },
            notes: { type: 'string' },
          },
        },
      },
    },
    required: ['summary', 'fairValue', 'drivers', 'risks'],
  };
  const prompt = `Symbol: ${payload.symbol}\nMetrics: ${JSON.stringify(payload.metrics)}\nSnapshots: ${JSON.stringify(payload.snapshots)}\nEvents: ${JSON.stringify((payload.events || []).slice(0, 6))}\nFilings: ${JSON.stringify((payload.filings || []).slice(0, 6))}\nInsights: ${JSON.stringify((payload.insights || []).slice(0, 6))}\nLevels: ${JSON.stringify(payload.levels || {})}\nRisk: ${JSON.stringify(payload.riskMetrics || {})}\nPeer set: ${JSON.stringify(payload.comparables || [])}\nReturn a JSON object following the schema.`;
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: resolvedModel,
      temperature: 0.35,
      response_format: { type: 'json_schema', json_schema: { name: 'valuation_schema', schema } },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${text.slice(0, 200)}`);
  }
  let parsed = null;
  if (text) {
    try {
      const data = JSON.parse(text);
      const content = data?.choices?.[0]?.message?.content || '';
      const cleaned = content.trim().replace(/^```json\s*/i, '').replace(/```$/i, '');
      parsed = JSON.parse(cleaned || content);
    } catch (error) {
      console.warn('Failed to parse OpenAI response', error, text.slice(0, 200));
      throw new Error('ChatGPT response parsing failed');
    }
  }
  return parsed;
}

function mergeAiWithHeuristic(aiRaw, heuristic, requestedModel, resolvedModel) {
  if (!aiRaw || typeof aiRaw !== 'object') return heuristic;
  const currency = heuristic?.fairValue?.currency || aiRaw?.fairValue?.currency || 'USD';
  const fairValue = {
    base: safeNumber(aiRaw?.fairValue?.base, heuristic?.fairValue?.base),
    rangeHigh: safeNumber(aiRaw?.fairValue?.rangeHigh, heuristic?.fairValue?.rangeHigh),
    rangeLow: safeNumber(aiRaw?.fairValue?.rangeLow, heuristic?.fairValue?.rangeLow),
    currency,
  };
  const expectedReturn = {
    upside: safeNumber(aiRaw?.expectedReturn?.upside, heuristic?.expectedReturn?.upside),
    downside: safeNumber(aiRaw?.expectedReturn?.downside, heuristic?.expectedReturn?.downside),
  };
  return {
    symbol: heuristic.symbol,
    model: {
      requested: requestedModel,
      resolved: resolvedModel,
      provider: 'openai',
    },
    generatedAt: new Date().toISOString(),
    summary: aiRaw.summary || heuristic.summary,
    fairValue,
    expectedReturn,
    conviction: aiRaw.conviction || heuristic.conviction,
    drivers: Array.isArray(aiRaw.drivers) && aiRaw.drivers.length ? aiRaw.drivers : heuristic.drivers,
    risks: Array.isArray(aiRaw.risks) && aiRaw.risks.length ? aiRaw.risks : heuristic.risks,
    scenarios: Array.isArray(aiRaw.scenarios) && aiRaw.scenarios.length ? aiRaw.scenarios : heuristic.scenarios,
    recommendation: aiRaw.recommendation || heuristic.recommendation,
    note: aiRaw.note || '',
    peerSignals: normalisePeerSignals(aiRaw.peerSignals || aiRaw.peerSet, currency).length
      ? normalisePeerSignals(aiRaw.peerSignals || aiRaw.peerSet, currency)
      : heuristic.peerSignals,
  };
}

export default async function handler(request) {
  if (request.method && request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }
  let payload = {};
  try {
    payload = await request.json();
  } catch (error) {
    return new Response('Invalid JSON body', { status: 400, headers: corsHeaders });
  }
  const symbol = String(payload.symbol || 'AAPL').toUpperCase();
  const requestedModel = payload.model || 'chatgpt-5';
  const resolvedModel = resolveModel(requestedModel) || DEFAULT_MODEL;
  const heuristic = buildHeuristicValuation({ ...payload, symbol, model: requestedModel });

  if (!process.env.OPENAI_API_KEY) {
    heuristic.note = 'OpenAI API key missing; reverting to heuristic equity intelligence.';
    return Response.json(heuristic, { headers: corsHeaders });
  }

  try {
    const aiRaw = await callOpenAi({ ...payload, symbol, model: requestedModel }, resolvedModel);
    const merged = mergeAiWithHeuristic(aiRaw, heuristic, requestedModel, resolvedModel);
    return Response.json(merged, { headers: corsHeaders });
  } catch (error) {
    console.error('intelligence function error', error);
    heuristic.warning = `ChatGPT valuation unavailable: ${error.message || error}`;
    return Response.json(heuristic, {
      headers: { ...corsHeaders, 'x-ai-fallback': 'heuristic' },
    });
  }
}

export { handler };
