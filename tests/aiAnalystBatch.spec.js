import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as env from '../netlify/functions/lib/env.js';
import { handleRequest } from '../netlify/functions/aiAnalystBatch.js';

const buildRequest = (path) => new Request(`http://localhost${path}`, { method: 'GET' });

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('aiAnalystBatch', () => {
  it('returns batch intelligence for provided symbols', async () => {
    vi.spyOn(env, 'getTiingoToken').mockReturnValue('');
    const response = await handleRequest(buildRequest('/.netlify/functions/aiAnalystBatch?symbols=AAPL,MSFT&limit=60'));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(Array.isArray(payload.results)).toBe(true);
    expect(payload.results.length).toBeGreaterThan(0);
    const first = payload.results[0];
    expect(first).toHaveProperty('symbol');
    expect(first).toHaveProperty('aiUpsidePct');
  });

  it('requires at least one symbol', async () => {
    const response = await handleRequest(buildRequest('/.netlify/functions/aiAnalystBatch'));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/provide/i);
  });
});
