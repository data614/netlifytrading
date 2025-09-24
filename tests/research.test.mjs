import test from 'node:test';
import assert from 'node:assert/strict';
import researchHandler from '../netlify/functions/research.js';

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

test('research function returns deterministic fallback when Tiingo token missing', async () => {
  delete process.env.TIINGO_API_KEY;
  const request = new Request('https://example.org/api/research?symbol=MSFT');
  const response = await researchHandler(request);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.symbol, 'MSFT');
  assert.ok(Array.isArray(body.events));
  assert.ok(body.warnings.some((msg) => msg.includes('Tiingo API key missing')));
  assert.ok(body.metrics.currentPrice != null);
});

test('research function aggregates Tiingo datasets when available', async () => {
  process.env.TIINGO_API_KEY = 'TEST';
  global.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url || input);
    if (url.pathname.startsWith('/tiingo/daily/AAPL/prices')) {
      return new Response(JSON.stringify([
        { date: '2024-01-01T00:00:00Z', close: 170, high: 172, low: 168, volume: 1800000 },
        { date: '2024-01-02T00:00:00Z', close: 172, high: 173, low: 169, volume: 1750000 },
        { date: '2024-01-03T00:00:00Z', close: 175, high: 176, low: 171, volume: 1900000 },
      ]), { status: 200 });
    }
    if (url.pathname === '/tiingo/daily/AAPL') {
      return new Response(JSON.stringify({
        name: 'Apple Inc.',
        exchangeCode: 'XNAS',
        sector: 'Technology',
        industry: 'Consumer Electronics',
        url: 'https://www.apple.com',
      }), { status: 200 });
    }
    if (url.pathname === '/tiingo/news') {
      return new Response(JSON.stringify([
        { title: 'AI Expansion', url: 'https://example.com', publishedDate: '2024-01-03T12:00:00Z', description: 'New AI initiative', tags: ['AI'] },
      ]), { status: 200 });
    }
    if (url.pathname.startsWith('/tiingo/sec/AAPL')) {
      return new Response(JSON.stringify([
        { formType: '10-Q', filingDate: '2024-01-02', description: 'Quarterly update', filingUrl: 'https://sec.example.com' },
      ]), { status: 200 });
    }
    if (url.pathname === '/iex') {
      return new Response(JSON.stringify([
        { ticker: 'AAPL', last: 176.2, prevClose: 175.0, volume: 2100000, timestamp: '2024-01-03T15:45:00Z' },
      ]), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${url.href}`);
  };
  const request = new Request('https://example.org/api/research?symbol=AAPL');
  const response = await researchHandler(request);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.symbol, 'AAPL');
  assert.equal(body.company.name, 'Apple Inc.');
  assert.ok(body.metrics.currentPrice > 0);
  assert.ok(body.snapshots['1M'].returnPct != null);
  assert.ok(body.events.length >= 1);
  assert.ok(body.filings.length >= 1);
  assert.ok(Array.isArray(body.scenarios) && body.scenarios.length === 3);
  assert.ok(Array.isArray(body.comparables) && body.comparables.length >= 1);
});
