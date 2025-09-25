import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadCompanyDocuments, loadCorporateActions } from '../netlify/functions/tiingo.js';

const TOKEN = 'test-token';
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => { vi.restoreAllMocks(); });

describe('documents and actions loaders', () => {
  it('normalizes SEC documents with documentType', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([
      { id: 1, title: 'AAPL 10-Q', tags: ['SEC', '10-Q'], publishedDate: '2024-08-05T00:00:00Z' },
      { id: 2, title: 'Press', tags: ['NEWS'], publishedDate: '2024-08-01T00:00:00Z' },
    ])));
    const docs = await loadCompanyDocuments('AAPL', 5, TOKEN);
    expect(docs.length).toBeGreaterThan(0);
    expect(docs[0].documentType).toBeDefined();
  });

  it('maps dividends and splits', async () => {
    const fetchMock = vi.fn(async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('/dividends')) return jsonResponse([{ exDate: '2024-08-09', amount: 0.24, currency: 'USD' }]);
      if (url.pathname.includes('/splits')) return jsonResponse([{ exDate: '2020-08-31', numerator: 4, denominator: 1 }]);
      throw new Error('unexpected');
    });
    vi.stubGlobal('fetch', fetchMock);

    const actions = await loadCorporateActions('AAPL', TOKEN);
    expect(actions.dividends.length).toBe(1);
    expect(actions.splits.length).toBe(1);
  });
});
