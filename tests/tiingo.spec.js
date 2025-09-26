import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadEod,
  loadIntraday,
  loadFundamentals,
  loadCompanyNews,
  loadCompanyOverview,
  loadFinancialStatements,
  loadSecFilings,
  loadValuation,
  __private,
} from '../netlify/functions/tiingo-data.js';

const TOKEN = 'test-token';
const { respondWithMock } = __private;

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

  it('normalizes financial statements into consistent sections', async () => {
    const statementsPayload = {
      incomeStatement: [
        {
          statementType: 'Income Statement',
          reportDate: '2024-03-31',
          data: [
            { label: 'Total Revenue', value: '1000' },
            { label: 'Net Income', value: 120 },
          ],
        },
      ],
      balanceSheet: {
        statementData: [
          {
            reportDate: '2024-03-31',
            data: [
              { label: 'Total Assets', value: 4000 },
              { label: 'Total Liabilities', value: 2500 },
            ],
          },
        ],
      },
      cashFlowStatement: [
        {
          statementType: 'Cash Flow Statement',
          reportDate: '2024-03-31',
          data: [
            { label: 'Operating Cash Flow', value: '300' },
            { label: 'Free Cash Flow', value: '250' },
          ],
        },
      ],
    };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(statementsPayload)));

    const statements = await loadFinancialStatements('TEST', TOKEN, 3);
    expect(statements.income[0].totalRevenue).toBe(1000);
    expect(statements.balanceSheet[0].totalAssets).toBe(4000);
    expect(statements.cashFlow[0].operatingCashFlow).toBe(300);
  });

  it('returns normalized overview data', async () => {
    const overviewPayload = {
      name: 'Test Corp',
      exchangeCode: 'NYSE',
      sector: 'Finance',
      industry: 'Banking',
      description: 'A diversified bank.',
      website: 'https://example.com/test',
      marketCap: '123456',
      sharesOutstanding: '789',
      currency: 'USD',
    };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(overviewPayload)));

    const overview = await loadCompanyOverview('TEST', TOKEN);
    expect(overview.name).toBe('Test Corp');
    expect(overview.exchange).toBe('NYSE');
    expect(overview.marketCap).toBe(123456);
    expect(overview.sharesOutstanding).toBe(789);
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

  it('maps SEC filings from news payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const url = new URL(input);
      expect(url.pathname).toContain('/tiingo/news');
      return jsonResponse([
        { id: 1, title: 'Form 10-K', tags: ['SEC', '10-K'], publishedDate: '2024-02-01T00:00:00Z' },
        { id: 2, title: 'Earnings Release', tags: ['Earnings'], publishedDate: '2024-01-15T00:00:00Z' },
      ]);
    }));

    const filings = await loadSecFilings('TEST', 5, TOKEN);
    expect(filings).toHaveLength(2);
    expect(filings[0].documentType).toBe('10-K');
    expect(filings[1].documentType).toBe('Filing');
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

  it('falls back to file-backed mock data when live calls fail', async () => {
    const response = await respondWithMock('overview', 'AAPL', 5, 'Mock fallback', { reason: 'test' });
    expect(response.headers.get('x-tiingo-source')).toBe('mock');
    const payload = await response.json();
    expect(payload.data.name).toBe('Apple Inc.');
    expect(payload.meta.mockSource).toBe('file:symbol');
    expect(payload.meta.source).toBe('mock');
  });
});
