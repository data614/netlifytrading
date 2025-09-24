import test from 'node:test';
import assert from 'node:assert/strict';
import handleTiingoRequest, { resolveSymbolRequests } from '../netlify/functions/tiingo.js';

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

test('resolveSymbolRequests deduplicates and normalises symbols', () => {
  const requests = resolveSymbolRequests('AAPL, msft , aapl', 'XNYS');
  assert.equal(requests.length, 2);
  const symbols = requests.map((r) => r.symbol);
  assert.deepEqual(symbols.sort(), ['AAPL', 'MSFT']);
  assert.ok(requests.every((r) => r.mic === 'XNYS'));
});

test('tiingo handler returns mock payload when token missing', async () => {
  delete process.env.TIINGO_API_KEY;
  const request = new Request('https://example.org/api/tiingo?symbol=AAPL&kind=intraday&limit=5');
  const response = await handleTiingoRequest(request);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.data));
  assert.ok(body.warning.includes('Tiingo API key missing'));
});

test('tiingo handler falls back to end-of-day data when intraday unavailable', async () => {
  process.env.TIINGO_API_KEY = 'TEST';
  let intradayCalls = 0;
  global.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url || input);
    if (url.pathname.startsWith('/iex/')) {
      intradayCalls += 1;
      throw new Error('intraday down');
    }
    if (url.pathname.startsWith('/tiingo/daily/AAPL/prices')) {
      return new Response(JSON.stringify([
        { date: '2024-01-01T00:00:00Z', close: 100, high: 101, low: 99, volume: 100000 },
        { date: '2024-01-02T00:00:00Z', close: 102, high: 103, low: 101, volume: 125000 },
        { date: '2024-01-03T00:00:00Z', close: 104, high: 105, low: 103, volume: 130000 },
      ]), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${url.href}`);
  };
  const request = new Request('https://example.org/api/tiingo?symbol=AAPL&kind=intraday&interval=5min&limit=3');
  const response = await handleTiingoRequest(request);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.data));
  assert.equal(body.data.length, 3);
  assert.ok(body.warning.toLowerCase().includes('end-of-day'));
  assert.ok(intradayCalls > 0);
});

test('tiingo handler provides quotes for intraday_latest requests', async () => {
  process.env.TIINGO_API_KEY = 'TEST';
  global.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url || input);
    if (url.pathname === '/iex') {
      return new Response(JSON.stringify([
        { ticker: 'AAPL', last: 190.5, prevClose: 188.2, volume: 2000000, timestamp: '2024-01-03T15:30:00Z' },
      ]), { status: 200 });
    }
    if (url.pathname.startsWith('/tiingo/daily/AAPL/prices')) {
      return new Response(JSON.stringify([
        { date: '2024-01-02T00:00:00Z', close: 188.2, high: 189.5, low: 186.9, volume: 1800000 },
      ]), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${url.href}`);
  };
  const request = new Request('https://example.org/api/tiingo?symbol=AAPL&kind=intraday_latest');
  const response = await handleTiingoRequest(request);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.data));
  assert.equal(body.data[0].symbol, 'AAPL');
  assert.ok(body.data[0].price > 0);
});
