import { describe, it, expect, beforeEach, vi } from 'vitest';

const fetchMock = vi.fn();

vi.mock('../utils/ai-analyst-client.js', () => ({
  __esModule: true,
  fetchAnalystIntel: fetchMock,
}));

const { normalizeSymbolList, runBatchAnalystIntel } = await import('../utils/ai-analyst-batch.js');

const createResolvedFetch = (delay = 0) => ({ symbol, signal }) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve({ data: { symbol }, warning: null });
    }, delay);

    if (signal) {
      const abortHandler = () => {
        clearTimeout(timer);
        const error = new Error('Aborted');
        error.name = 'AbortError';
        reject(error);
      };
      if (signal.aborted) {
        abortHandler();
      } else {
        signal.addEventListener('abort', abortHandler, { once: true });
      }
    }
  });

describe('normalizeSymbolList', () => {
  it('deduplicates and uppercases tickers from various inputs', () => {
    const result = normalizeSymbolList('aapl, msft\nGOOG AAPL');
    expect(result).toEqual(['AAPL', 'MSFT', 'GOOG']);
  });

  it('extracts symbols from object payloads', () => {
    const result = normalizeSymbolList({ symbols: ['spy', 'xly'], tickers: ['ignored'] });
    expect(result).toEqual(['SPY', 'XLY']);
  });
});

describe('runBatchAnalystIntel', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('processes symbols sequentially when concurrency is one', async () => {
    fetchMock.mockImplementation(createResolvedFetch());
    const progressEvents = [];
    const { successes, failures, total } = await runBatchAnalystIntel({
      symbols: ['AAPL', 'MSFT', 'GOOG'],
      concurrency: 1,
      onProgress: (event) => progressEvents.push(event),
    });

    expect(total).toBe(3);
    expect(successes).toHaveLength(3);
    expect(failures).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(progressEvents.filter((event) => event.status === 'started')).toHaveLength(3);
    expect(progressEvents.filter((event) => event.status === 'fulfilled')).toHaveLength(3);
  });

  it('honours abort signals and stops remaining work', async () => {
    fetchMock.mockImplementation(createResolvedFetch(50));
    const controller = new AbortController();

    const batchPromise = runBatchAnalystIntel({
      symbols: ['AAPL', 'MSFT', 'GOOG'],
      concurrency: 2,
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(), 10);

    await expect(batchPromise).rejects.toMatchObject({ name: 'AbortError' });
  });
});
