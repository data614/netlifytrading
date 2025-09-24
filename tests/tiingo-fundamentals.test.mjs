import test from 'node:test';
import assert from 'node:assert/strict';
import handleFundamentalsRequest, { __testables } from '../netlify/functions/tiingo-fundamentals.js';

const {
  parseSymbols,
  computeValuation,
  computeQualityScore,
  computeMomentumScore,
  generateFallbackRecord,
} = __testables;

test('parseSymbols normalises colon and suffix formats', () => {
  const entries = parseSymbols('ASX:WOW, BARC.L', '');
  assert.deepEqual(entries.map((e) => e.symbol), ['WOW', 'BARC']);
  assert.equal(entries[0].mic, 'XASX');
  assert.equal(entries[1].mic, 'XLON');
});

test('valuation model returns sensible upside signal', () => {
  const valuations = computeValuation({
    eps: 6,
    revenueGrowth: 0.1,
    operatingMargin: 0.28,
    forwardPe: 20,
    freeCashFlowPerShare: 5.6,
  }, 170);
  assert.ok(valuations.fairValue > 0);
  assert.ok(Number.isFinite(valuations.upside));
  assert.ok(['Strong upside', 'Moderate upside', 'Fairly valued', 'Slight downside', 'Overvalued'].includes(valuations.signalLabel));
});

test('quality and momentum scores are bounded between 0 and 100', () => {
  const quality = computeQualityScore({
    revenueGrowth: 0.12,
    operatingMargin: 0.32,
    returnOnEquity: 0.4,
    freeCashFlowPerShare: 6,
    debtToEquity: 0.8,
    dividendYield: 0.02,
  });
  assert.ok(quality >= 0 && quality <= 100);

  const momentum = computeMomentumScore(180, {
    week52High: 210,
    week52Low: 140,
    monthChange: 0.04,
    quarterChange: 0.1,
  });
  assert.ok(momentum >= 0 && momentum <= 100);
});

test('fallback record provides illustrative fundamentals', () => {
  const record = generateFallbackRecord('TEST');
  assert.equal(record.symbol, 'TEST');
  assert.ok(record.events.length >= 1);
  assert.ok(record.documents.length >= 1);
  assert.ok(record.valuations.fairValue > 0);
});

test('handler returns fallback data when token is missing', async () => {
  const keys = ['TIINGO_KEY', 'TIINGO_API_KEY', 'TIINGO_TOKEN', 'TIINGO_ACCESS_TOKEN', 'REACT_APP_TIINGO_KEY', 'REACT_APP_TIINGO_TOKEN', 'REACT_APP_API_KEY'];
  const backup = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  keys.forEach((key) => { delete process.env[key]; });
  try {
    const response = await handleFundamentalsRequest(new Request('https://example.org/.netlify/functions/tiingo-fundamentals?symbols=AAPL'));
    const body = await response.json();
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.length >= 1);
    assert.ok(body.warning);
    assert.equal(body.fallback, true);
  } finally {
    Object.entries(backup).forEach(([key, value]) => {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    });
  }
});
