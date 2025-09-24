import test from 'node:test';
import assert from 'node:assert/strict';

const { handler } = await import('../netlify/functions/tiingo-events.js');

const withFetch = async (impl, fn) => {
  const original = global.fetch;
  global.fetch = impl;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
};

const sampleArticles = [
  {
    id: '1',
    title: 'Company beats earnings expectations',
    publishedDate: '2024-04-30T10:00:00Z',
    tags: ['earnings'],
    description: 'Revenue and EPS exceeded consensus. Management raised guidance.',
    sentimentScore: 0.4,
    url: 'https://example.com/earnings',
    source: 'Reuters',
  },
  {
    id: '2',
    title: 'Regulators open antitrust inquiry',
    publishedDate: '2024-04-28T12:00:00Z',
    tags: ['regulation'],
    description: 'Authorities are looking into platform billing practices.',
    sentimentScore: -0.3,
    url: 'https://example.com/reg',
    source: 'Bloomberg',
  },
];

test('classifies events when Tiingo news available', async () => {
  process.env.TIINGO_KEY = 'demo-token';
  await withFetch(async (input) => {
    const url = new URL(input);
    if (url.pathname === '/tiingo/news') {
      return new Response(JSON.stringify(sampleArticles), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, async () => {
    const event = { rawQuery: 'symbol=AAPL&limit=2', httpMethod: 'GET', path: '/api/tiingo-events', headers: {} };
    const response = await handler(event);
    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body);
    assert.equal(payload.events.length, 2);
    assert.equal(payload.events[0].type, 'Earnings');
    assert.equal(payload.events[1].type, 'Regulatory');
  });
});

test('falls back to curated events when token missing', async () => {
  delete process.env.TIINGO_KEY;
  const response = await handler({ rawQuery: 'symbol=AAPL&limit=2', httpMethod: 'GET', path: '/api/tiingo-events', headers: {} });
  const payload = JSON.parse(response.body);
  assert.equal(payload.fallback, true);
  assert.ok(payload.events.length > 0);
  assert.ok(payload.warning);
});
