import test from 'node:test';
import assert from 'node:assert/strict';

const { handler } = await import('../netlify/functions/tiingo.js');

const withStubbedFetch = async (impl, fn) => {
  const original = global.fetch;
  global.fetch = impl;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
};

test('intraday series returns ordered candles when Tiingo token present', async () => {
  process.env.TIINGO_KEY = 'demo-token';
  const mockSeries = [
    { date: '2024-05-01T14:00:00Z', close: 180.1, open: 179.6 },
    { date: '2024-05-01T14:05:00Z', close: 180.5, open: 180.1 },
    { date: '2024-05-01T14:10:00Z', close: 181.0, open: 180.5 },
  ];
  await withStubbedFetch(async (input) => {
    const url = new URL(input);
    if (url.pathname.includes('/iex/AAPL/prices')) {
      return new Response(JSON.stringify(mockSeries), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, async () => {
    const event = { rawQuery: 'symbol=AAPL&kind=intraday&interval=5min&limit=3', httpMethod: 'GET', path: '/api/tiingo', headers: {} };
    const response = await handler(event);
    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body);
    assert.equal(payload.data.length, 3);
    const times = payload.data.map((row) => new Date(row.date).getTime());
    assert.ok(times[0] < times[1] && times[1] < times[2]);
  });
});

test('intraday_latest falls back to EOD when realtime feed fails', async () => {
  process.env.TIINGO_KEY = 'demo-token';
  await withStubbedFetch(async (input) => {
    const url = new URL(input);
    if (url.pathname === '/iex') {
      return new Response('error', { status: 500 });
    }
    if (url.pathname.includes('/tiingo/daily')) {
      const eod = [
        { date: '2024-04-29', close: 175.2, open: 174.8 },
        { date: '2024-04-30', close: 176.4, open: 175.0 },
      ];
      return new Response(JSON.stringify(eod), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, async () => {
    const event = { rawQuery: 'symbol=AAPL&kind=intraday_latest', httpMethod: 'GET', path: '/api/tiingo', headers: {} };
    const response = await handler(event);
    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body);
    assert.equal(payload.data.length, 1);
    assert.ok(payload.warning);
    assert.equal(payload.data[0].close, 176.4);
  });
});

test('returns mock data when Tiingo token missing', async () => {
  delete process.env.TIINGO_KEY;
  await withStubbedFetch(async () => {
    throw new Error('fetch should not be called without token');
  }, async () => {
    const event = { rawQuery: 'symbol=AAPL&kind=eod&limit=5', httpMethod: 'GET', path: '/api/tiingo', headers: {} };
    const response = await handler(event);
    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body);
    assert.ok(Array.isArray(payload.data));
    assert.ok(payload.warning);
  });
});
