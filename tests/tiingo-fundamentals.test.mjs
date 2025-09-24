import test from 'node:test';
import assert from 'node:assert/strict';

const { handler } = await import('../netlify/functions/tiingo-fundamentals.js');

const withFetch = async (impl, fn) => {
  const original = global.fetch;
  global.fetch = impl;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
};

const sampleRows = [
  {
    date: '2021-09-25',
    revenue: 3.47e11,
    netIncome: 9.46e10,
    freeCashFlow: 9.3e10,
    sharesOutstanding: 16.5e9,
    marketCap: 2.4e12,
    totalDebt: 1.1e11,
    cashAndCashEquivalents: 6.2e10,
    shareholderEquity: 6.3e10,
    eps: 5.11,
    peRatio: 22,
    psRatio: 6,
    pbRatio: 8,
    dividendYield: 0.005,
    returnOnEquity: 0.35,
    returnOnInvestedCapital: 0.28,
    costOfCapital: 0.085,
  },
  {
    date: '2022-09-24',
    revenue: 3.95e11,
    netIncome: 9.99e10,
    freeCashFlow: 9.8e10,
    sharesOutstanding: 16.1e9,
    marketCap: 2.5e12,
    totalDebt: 1.1e11,
    cashAndCashEquivalents: 5.6e10,
    shareholderEquity: 6.5e10,
    eps: 5.89,
    peRatio: 23,
    psRatio: 6.2,
    pbRatio: 8.2,
    dividendYield: 0.005,
    returnOnEquity: 0.34,
    returnOnInvestedCapital: 0.29,
    costOfCapital: 0.085,
  },
  {
    date: '2023-09-30',
    revenue: 3.83e11,
    netIncome: 9.65e10,
    freeCashFlow: 9.7e10,
    sharesOutstanding: 15.7e9,
    marketCap: 2.7e12,
    totalDebt: 1.07e11,
    cashAndCashEquivalents: 5.3e10,
    shareholderEquity: 6.8e10,
    eps: 6.11,
    peRatio: 27,
    psRatio: 7,
    pbRatio: 9,
    dividendYield: 0.005,
    returnOnEquity: 0.32,
    returnOnInvestedCapital: 0.3,
    wacc: 0.082,
  },
  {
    date: '2024-03-30',
    revenue: 3.9e11,
    netIncome: 9.7e10,
    freeCashFlow: 9.9e10,
    sharesOutstanding: 15.6e9,
    marketCap: 3.0e12,
    totalDebt: 1.05e11,
    cashAndCashEquivalents: 5.5e10,
    shareholderEquity: 7.1e10,
    eps: 6.25,
    peRatio: 28,
    psRatio: 7.2,
    pbRatio: 9.2,
    dividendYield: 0.0051,
    returnOnEquity: 0.31,
    returnOnInvestedCapital: 0.3,
    wacc: 0.082,
  },
];

test('computes valuations and quality metrics when Tiingo responds', async () => {
  process.env.TIINGO_KEY = 'demo-token';
  await withFetch(async (input) => {
    const url = new URL(input);
    if (url.pathname.includes('/tiingo/fundamentals')) {
      return new Response(JSON.stringify(sampleRows), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }, async () => {
    const event = { rawQuery: 'symbol=AAPL', httpMethod: 'GET', path: '/api/tiingo-fundamentals', headers: {} };
    const response = await handler(event);
    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body);
    assert.equal(payload.fallback, false);
    assert.ok(payload.valuations?.dcf?.fairValue > 0);
    assert.ok(payload.valuations?.blended?.qualityScore > 0);
    assert.ok(Array.isArray(payload.table) && payload.table.length >= 3);
  });
});

test('falls back to illustrative sample when token missing', async () => {
  delete process.env.TIINGO_KEY;
  const response = await handler({ rawQuery: 'symbol=MSFT', httpMethod: 'GET', path: '/api/tiingo-fundamentals', headers: {} });
  const payload = JSON.parse(response.body);
  assert.equal(payload.fallback, true);
  assert.ok(payload.warning);
  assert.equal(payload.symbol, 'MSFT');
});
