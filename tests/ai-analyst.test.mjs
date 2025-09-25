import test from 'node:test';
import assert from 'node:assert/strict';

const { handler } = await import('../netlify/functions/ai-analyst.js');

const baseEvent = {
  httpMethod: 'POST',
  path: '/api/ai-analyst',
  headers: { 'content-type': 'application/json' },
};

const withFetch = async (impl, fn) => {
  const original = global.fetch;
  global.fetch = impl;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
};

const buildBody = (payload) => JSON.stringify({
  mode: 'screener',
  symbol: 'AAPL',
  focus: 'growth',
  riskTolerance: 'balanced',
  horizon: 'medium',
  quote: { price: 180, previousClose: 177, currency: 'USD' },
  valuations: { blended: { fairValue: 195, confidence: 0.6 } },
  events: [{ title: 'Earnings beat', impactScore: 4, summary: 'Upside surprise.' }],
  ...payload,
});

test('returns fallback analysis when API key missing', async () => {
  delete process.env.OPENAI_API_KEY;
  const response = await handler({ ...baseEvent, body: buildBody() });
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.fallback, true);
  assert.match(payload.analysis, /AI analysis offline/i);
});

test('proxies to OpenAI when API key configured', async () => {
  process.env.OPENAI_API_KEY = 'demo-key';
  await withFetch(async (input, init) => {
    const url = typeof input === 'string' ? new URL(input) : new URL(input.url);
    assert.equal(url.hostname, 'api.openai.com');
    const body = JSON.parse(init.body);
    assert.equal(body.messages[1].role, 'user');
    return new Response(JSON.stringify({
      model: 'gpt-5.0-preview',
      choices: [{ message: { content: 'Analysis ready.' } }],
      usage: { total_tokens: 300 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, async () => {
    const response = await handler({ ...baseEvent, body: buildBody({ universe: 'MSFT, NVDA' }) });
    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body);
    assert.equal(payload.analysis, 'Analysis ready.');
    assert.equal(payload.model, 'gpt-5.0-preview');
    assert.ok(payload.warning.includes('OPENAI_ANALYST_MODEL'));
  });
});
