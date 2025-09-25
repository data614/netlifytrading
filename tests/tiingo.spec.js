import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadEod,
  loadIntraday,
  loadFundamentals,
  loadCompanyNews,
  loadValuation,
} from '../netlify/functions/tiingo.js';

const TOKEN = 'test-token';

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('tiingo data loaders', () => {
  it('normalizes EOD rows with sorted output', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([
      { date: '2023-01-02', close: 100, open: 98, high: 102, low: 97, volume: 1000 },
      { date: '2023-01-03', close: 103, open: 101, high: 105, low: 100, volume: 1100 },
    ])));

    const rows = await loadEod('TEST', 2, TOKEN);
    expect(rows).toHaveLength(2);
    expect(rows[0].symbol).toBe('TEST');
    expect(rows[1].close).toBe(103);
    expect(rows[1].previousClose).toBe(100);
  });

  it('computes intraday series', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([
      { date: '2023-01-03T10:00:00Z', close: 101, prevClose: 100, volume: 200 },
      { date: '2023-01-03T10:05:00Z', close: 102, prevClose: 101, volume: 250 },
    ])));

    const rows = await loadIntraday('TEST', '5min', 2, TOKEN);
    expect(rows[0].previousClose).toBe(100);
    expect(rows[1].price).toBe(102);
  });

  it('maps fundamentals metrics with growth signals', async () => {
    const fundamentalsPayload = [
      { reportDate: '2023-03-31', totalRevenue: 1000, netIncome: 100, freeCashFlow: 80, eps: 2, bookValuePerShare: 10, sharesBasic: 50 },
      { reportDate: '2023-06-30', totalRevenue: 1100, netIncome: 120, freeCashFlow: 90, eps: 2.2, bookValuePerShare: 10.5, sharesBasic: 50 },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(fundamentalsPayload)));

    const fundamentals = await loadFundamentals('TEST', TOKEN, 2);
    expect(fundamentals.metrics.revenuePerShare).toBeGreaterThan(0);
    expect(fundamentals.metrics.revenueGrowth).toBeGreaterThan(0);
    expect(fundamentals.metrics.epsGrowth).toBeGreaterThan(0);
  });

  it('normalizes company news ordering', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([
      { publishedDate: '2023-06-02T00:00:00Z', title: 'Older', sentiment: 0.1 },
      { publishedDate: '2023-06-04T00:00:00Z', title: 'Newer', sentiment: -0.3 },
    ])));

    const news = await loadCompanyNews('TEST', 5, TOKEN);
    expect(news[0].headline).toBe('Newer');
    expect(news[0].sentiment).toBe(-0.3);
  });

  it('assembles valuation snapshot with quote and fundamentals', async () => {
    const fetchMock = vi.fn(async (input) => {
      const url = new URL(input);
      if (url.pathname === '/iex') {
        return jsonResponse([{ ticker: 'TEST', last: 105, prevClose: 100 }]);
      }
      if (url.pathname.includes('/fundamentals')) {
        return jsonResponse([
          { reportDate: '2023-06-30', totalRevenue: 1100, netIncome: 120, freeCashFlow: 90, eps: 2.2, bookValuePerShare: 10.5, sharesBasic: 50 },
        ]);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const valuation = await loadValuation('TEST', TOKEN);
    expect(valuation.price).toBe(105);
    expect(valuation.valuation.fairValue).toBeGreaterThan(0);
    expect(valuation.narrative).toMatch(/TEST/);
  });
});
