import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const MODULE_PATH = '../netlify/functions/tiingo.js';

const originalFetch = global.fetch;

const buildRequest = (queryString) => new Request(`https://example.org/.netlify/functions/tiingo${queryString ? `?${queryString}` : ''}`);

function mockFetch(handler) {
  global.fetch = vi.fn(async (input, init) => {
    const url = typeof input === 'string' || input instanceof URL
      ? new URL(input, 'https://api.tiingo.com')
      : new URL(input?.url || 'https://api.tiingo.com', 'https://api.tiingo.com');
    return handler(url, init);
  });
  return global.fetch;
}

describe('tiingo Netlify function', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.TIINGO_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.TIINGO_KEY;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns chronologically sorted intraday data', async () => {
    const mockSeries = [
      { date: '2024-06-10T14:35:00Z', open: 100, high: 102, low: 99, close: 101, volume: 1000 },
      { date: '2024-06-10T14:40:00Z', open: 101, high: 103, low: 100, close: 102, volume: 1100 },
      { date: '2024-06-10T14:45:00Z', open: 102, high: 104, low: 101, close: 103, volume: 900 },
    ];

    mockFetch((url) => {
      expect(url.pathname).toContain('/iex/AAPL/prices');
      return Promise.resolve(new Response(JSON.stringify(mockSeries), { status: 200 }));
    });

    const { default: tiingo } = await import(`${MODULE_PATH}?case=intraday`);
    const response = await tiingo(buildRequest('symbol=AAPL&kind=intraday&interval=5min&limit=3'));
    const payload = await response.json();

    expect(Array.isArray(payload.data)).toBe(true);
    expect(payload.data).toHaveLength(3);
    const dates = payload.data.map((row) => new Date(row.date).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
    expect(payload.data[0]).toMatchObject({ symbol: 'AAPL' });
    expect(payload.data[0].open).toBeTypeOf('number');
    expect(payload.data[0].close).toBeTypeOf('number');
  });

  it('falls back to end-of-day data when intraday fails', async () => {
    const mockEod = [
      { date: '2024-05-01', open: 98, high: 100, low: 95, close: 99, volume: 1500000 },
      { date: '2024-05-02', open: 99, high: 103, low: 98, close: 102, volume: 1200000 },
    ];

    mockFetch((url) => {
      if (url.pathname.includes('/iex/')) {
        return Promise.resolve(new Response('error', { status: 500 }));
      }
      if (url.pathname.includes('/tiingo/daily')) {
        return Promise.resolve(new Response(JSON.stringify(mockEod), { status: 200 }));
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });

    const { default: tiingo } = await import(`${MODULE_PATH}?case=fallback`);
    const response = await tiingo(buildRequest('symbol=MSFT&kind=intraday&interval=5min&limit=2'));
    const payload = await response.json();

    expect(payload.data).toHaveLength(2);
    expect(payload.warning).toMatch(/end-of-day/i);
    expect(payload.data[0]).toMatchObject({ symbol: 'MSFT' });
  });

  it('returns real-time intraday_latest quotes for eligible tickers', async () => {
    const realtimeQuote = [{ ticker: 'AAPL', last: 175.5, prevClose: 173.2, volume: 1200000 }];

    const fetchMock = mockFetch((url) => {
      if (url.pathname === '/iex') {
        return new Response(JSON.stringify(realtimeQuote), { status: 200 });
      }
      if (url.pathname.includes('/tiingo/daily/')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });

    const { default: tiingo } = await import(`${MODULE_PATH}?case=latest-us`);
    const response = await tiingo(buildRequest('symbol=AAPL&kind=intraday_latest'));
    const payload = await response.json();

    expect(fetchMock).toHaveBeenCalled();
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].symbol).toBe('AAPL');
    expect(payload.data[0].price).toBeCloseTo(175.5, 5);
    expect(payload.warning || '').not.toMatch(/sample data/i);
  });

  it('falls back to end-of-day quotes for international intraday_latest requests', async () => {
    const fallbackDaily = [
      { date: '2024-06-07', close: 150, adjClose: 150, volume: 900000 },
      { date: '2024-06-10', close: 152, adjClose: 152, volume: 950000 },
    ];

    mockFetch((url) => {
      if (url.pathname === '/iex') {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.pathname.includes('/tiingo/daily/')) {
        return new Response(JSON.stringify(fallbackDaily), { status: 200 });
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });

    const { default: tiingo } = await import(`${MODULE_PATH}?case=latest-intl`);
    const response = await tiingo(buildRequest('symbol=SONY&kind=intraday_latest&exchange=XTKS'));
    const payload = await response.json();

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].symbol).toBe('SONY');
    expect(payload.data[0].price).toBeCloseTo(152, 5);
    expect(payload.warning).toMatch(/end-of-day/i);
  });
});

