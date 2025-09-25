import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as env from '../netlify/functions/lib/env.js';
import { gatherSymbolIntel } from '../netlify/functions/aiAnalyst.js';

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('gatherSymbolIntel', () => {
  it('returns simulated payload when token missing', async () => {
    vi.spyOn(env, 'getTiingoToken').mockReturnValue('');
    const intel = await gatherSymbolIntel('TEST', { limit: 60 });
    expect(intel.symbol).toBe('TEST');
    expect(intel.warning).toMatch(/missing/i);
    expect(intel.news.length).toBeGreaterThan(0);
    expect(intel.aiSummary).toMatch(/ChatGPT-5/i);
  });

  it('aggregates real fetch calls when token available', async () => {
    vi.spyOn(env, 'getTiingoToken').mockReturnValue('token');
    const fetchMock = vi.fn(async (input) => {
      const url = new URL(input);
      if (url.pathname === '/iex') {
        return jsonResponse([{ ticker: 'TEST', last: 120, prevClose: 118 }]);
      }
      if (url.pathname.includes('/fundamentals')) {
        return jsonResponse([
          {
            reportDate: '2023-06-30',
            totalRevenue: 1000,
            netIncome: 110,
            freeCashFlow: 90,
            eps: 2.5,
            bookValuePerShare: 11,
            sharesBasic: 50,
          },
        ]);
      }
      if (url.pathname === '/tiingo/news') {
        return jsonResponse([
          { publishedDate: '2023-07-01T00:00:00Z', title: 'Headline', sentiment: 0.5, url: 'https://example.com' },
        ]);
      }
      if (url.pathname.includes('/dividends')) {
        return jsonResponse([{ exDate: '2023-06-15', amount: 0.2 }]);
      }
      if (url.pathname.includes('/splits')) {
        return jsonResponse([]);
      }
      if (url.pathname.includes('/prices')) {
        return jsonResponse([
          { date: '2023-06-01', close: 110 },
          { date: '2023-06-30', close: 120 },
        ]);
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const intel = await gatherSymbolIntel('TEST', { limit: 60 });
    expect(intel.symbol).toBe('TEST');
    expect(intel.valuation.price).toBe(120);
    expect(intel.news[0].headline).toBe('Headline');
    expect(intel.timeline.length).toBeGreaterThan(0);
    expect(intel.aiSummary).toMatch(/ChatGPT-5/i);
  });
});
