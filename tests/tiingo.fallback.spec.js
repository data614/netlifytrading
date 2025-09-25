import { describe, it, expect, beforeEach, vi } from 'vitest';
import handleTiingoRequest, { handler as netlifyHandler } from '../netlify/functions/tiingo.js';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(process.env)) {
    if (k.includes('TIINGO')) delete process.env[k];
  }
});

describe('tiingo handler fallbacks', () => {
  it('returns mock data when token is missing (news)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));

    const event = { rawQuery: 'kind=news&symbol=AAPL', headers: {}, path: '/.netlify/functions/tiingo', httpMethod: 'GET' };
    const res = await netlifyHandler(event);
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-tiingo-fallback']).toBe('mock');
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('falls back to EOD when intraday unavailable', async () => {
    // First intraday fails, then EOD returns 1 item
    const fetchMock = vi.fn(async (input) => {
      const url = new URL(input);
      if (url.pathname.startsWith('/iex/')) throw new Error('intraday down');
      return jsonResponse([{ date: '2023-01-02', close: 100 }]);
    });
    vi.stubGlobal('fetch', fetchMock);

    // Force a fake token so handler tries live path
    process.env.TIINGO_KEY = '1234567890abcdef12345678';
    const event = { rawQuery: 'kind=intraday_latest&symbol=AAPL', headers: {}, path: '/.netlify/functions/tiingo', httpMethod: 'GET' };
    const res = await netlifyHandler(event);
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.warning).toMatch(/EOD/i);
  });
});
