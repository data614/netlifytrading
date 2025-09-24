import test from 'node:test';
import assert from 'node:assert/strict';
import intelligenceHandler from '../netlify/functions/intelligence.js';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

const reset = () => {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value;
  }
};

test.afterEach(reset);

const samplePayload = {
  symbol: 'AAPL',
  metrics: {
    currency: 'USD',
    currentPrice: 180,
    previousClose: 178,
    fiftyTwoWeekHigh: 195,
    fiftyTwoWeekLow: 140,
    riskLabel: 'Moderate',
    fairValueEstimate: 188,
    expectedReturn: { upside: 5, downside: -8 },
    averageVolume: 25000000,
  },
  snapshots: {
    '3M': { label: '3M', returnPct: 6 },
  },
  events: [
    { title: 'Earnings beat', publishedAt: '2024-01-03T00:00:00Z' },
  ],
  comparables: [
    { name: 'Peer One', profile: 'Tech', fairValue: 185, expectedReturn: 7, notes: 'Strong balance sheet' },
  ],
};

test('intelligence handler returns heuristic analysis when OpenAI key missing', async () => {
  delete process.env.OPENAI_API_KEY;
  const request = new Request('https://example.org/api/intelligence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(samplePayload),
  });
  const response = await intelligenceHandler(request);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.model.provider, 'heuristic');
  assert.ok(body.note.includes('heuristic'));
  assert.ok(body.fairValue.base != null);
});

test('intelligence handler merges OpenAI response when available', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.OPENAI_MODEL = 'gpt-4o-mini';
  global.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url || '';
    if (!url.includes('api.openai.com')) throw new Error(`Unexpected fetch ${url}`);
    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: 'AI generated summary',
              fairValue: { base: 192, rangeHigh: 205, rangeLow: 170, currency: 'USD' },
              expectedReturn: { upside: 7, downside: -5 },
              conviction: 'High',
              drivers: ['Robust AI demand'],
              risks: ['Execution risk'],
              scenarios: [
                { label: 'Bull', probability: 0.4, price: 210, returnPct: 12, commentary: 'AI adoption accelerates' },
              ],
              recommendation: { text: 'Overweight allocation' },
              note: 'AI confidence note',
              peerSignals: [
                { name: 'Peer Alpha', profile: 'Cloud', fairValue: 200, expectedReturn: 9, notes: 'Valuation discount' },
              ],
            }),
          },
        },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const request = new Request('https://example.org/api/intelligence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(samplePayload),
  });
  const response = await intelligenceHandler(request);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.model.provider, 'openai');
  assert.equal(body.fairValue.base, 192);
  assert.equal(body.recommendation.text, 'Overweight allocation');
  assert.ok(body.peerSignals.length >= 1);
});
