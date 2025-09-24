import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const MODULE_PATH = '../netlify/functions/companyIntel.js';
const originalFetch = global.fetch;

const buildRequest = (queryString) => new Request(`https://example.org/.netlify/functions/companyIntel${queryString ? `?${queryString}` : ''}`);

describe('companyIntel Netlify function', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.TIINGO_KEY;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns curated fallback intelligence when Tiingo key is missing', async () => {
    delete process.env.TIINGO_KEY;
    const { default: companyIntel } = await import(`${MODULE_PATH}?case=fallback`);
    const response = await companyIntel(buildRequest('symbol=AAPL'));
    const payload = await response.json();
    expect(payload.source).toBe('fallback');
    expect(payload.symbol).toBe('AAPL');
    expect(payload.warning).toMatch(/tiingo api key missing/i);
    expect(payload.events.length).toBeGreaterThan(0);
  });

  it('normalises Tiingo fundamentals and news into analytics', async () => {
    process.env.TIINGO_KEY = 'test-key';

    const fundamentals = [
      {
        date: '2024-05-01',
        currency: 'USD',
        sector: 'Technology',
        industry: 'Software',
        marketCap: 150000000000,
        revenueGrowth: 0.12,
        ebitdaMargin: 0.34,
        freeCashFlow: 12000000000,
        returnOnEquity: 0.45,
        netDebt: 5000000000,
        currentRatio: 1.9,
        interestCoverage: 8,
        eps: 6.5,
        closePrice: 140,
        peRatio: 21,
        forwardPe: 18,
        priceToSales: 6,
        evToEbitda: 12,
        riskPremium: 0.05,
      },
    ];

    const news = [
      {
        title: 'Company beats earnings expectations',
        description: 'Strong cloud momentum and margin expansion.',
        url: 'https://example.org/news',
        publishedDate: '2024-05-15T12:00:00Z',
        tags: ['Earnings', 'Filing'],
        sentimentScore: 0.45,
      },
      {
        title: 'Regulator opens inquiry into data practices',
        description: 'Preliminary review launched by European Commission.',
        url: 'https://example.org/regulation',
        publishedDate: '2024-05-28T08:00:00Z',
        tags: ['Regulation'],
        sentimentScore: -0.35,
      },
    ];

    global.fetch = vi.fn(async (input) => {
      const rawUrl = typeof input === 'string' ? input : input?.href || input?.url;
      if (!rawUrl) throw new Error('Missing request URL');
      const url = new URL(rawUrl);
      if (url.pathname.includes('/tiingo/fundamentals')) {
        expect(url.searchParams.get('token')).toBe('test-key');
        return new Response(JSON.stringify(fundamentals), { status: 200 });
      }
      if (url.pathname.includes('/tiingo/news')) {
        return new Response(JSON.stringify(news), { status: 200 });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const { default: companyIntel } = await import(`${MODULE_PATH}?case=live`);
    const response = await companyIntel(buildRequest('symbol=MSFT'));
    const payload = await response.json();

    expect(payload.source).toBe('tiingo');
    expect(payload.snapshot.marketCap).toBeCloseTo(150000000000);
    expect(payload.valuations.intrinsicValue).toBeGreaterThan(0);
    expect(payload.valuations.marginOfSafety).toBeTypeOf('number');
    expect(payload.events).toHaveLength(2);
    expect(payload.documents.length).toBeGreaterThanOrEqual(1);
  });
});

