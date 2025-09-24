import test from 'node:test';
import assert from 'node:assert/strict';
import handleAiAnalyst, { __testables } from '../netlify/functions/ai-analyst.js';

const { buildPrompt, offlineInsight } = __testables;

test('buildPrompt structures single equity payload', () => {
  const prompt = buildPrompt({
    mode: 'single-equity',
    symbol: 'AAPL',
    name: 'Apple Inc.',
    currency: 'USD',
    price: 189.2,
    valuations: { fairValue: 205, upside: 0.083 },
    qualityScore: 75,
    momentumScore: 62,
    events: [{ date: '2024-07-01', type: 'Earnings', headline: 'Q3 earnings call' }],
    documents: [{ date: '2024-05-01', type: 'SEC Filing', title: '10-Q filing' }],
    metrics: { revenueGrowth: 0.08, operatingMargin: 0.29, debtToEquity: 1.2 },
    narrative: 'Focus on services and AI attach rate.',
  });
  assert.match(prompt, /Instrument: AAPL/);
  assert.match(prompt, /Key events:/);
  assert.match(prompt, /Deliverable:/);
});

test('offlineInsight returns deterministic fallback content', () => {
  const result = offlineInsight({
    mode: 'single-equity',
    symbol: 'TEST',
    price: 100,
    valuations: { fairValue: 120, upside: 0.2 },
    qualityScore: 70,
    momentumScore: 60,
    metrics: { debtToEquity: 1.1 },
    events: [],
    documents: [],
  });
  assert.equal(result.model, 'chatgpt-5-offline');
  assert.ok(result.warning.includes('OPENAI_API_KEY'));
  assert.match(result.content, /View:/);
});

test('handler returns offline insight when OPENAI_API_KEY is absent', async () => {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const response = await handleAiAnalyst(new Request('https://example.org/.netlify/functions/ai-analyst', {
      method: 'POST',
      body: JSON.stringify({ mode: 'single-equity', symbol: 'AAPL' }),
      headers: { 'content-type': 'application/json' },
    }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.model, 'chatgpt-5-offline');
    assert.ok(body.warning);
  } finally {
    if (original) process.env.OPENAI_API_KEY = original;
  }
});
