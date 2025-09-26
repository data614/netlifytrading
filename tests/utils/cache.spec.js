import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAsyncCache } from '../../utils/cache.js';

describe('createAsyncCache', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns cached values within the configured ttl', async () => {
    vi.useFakeTimers();
    const cache = createAsyncCache({ ttlMs: 1_000, maxSize: 10 });
    const loader = vi.fn().mockResolvedValue('alpha');

    const first = await cache.get('key', loader);
    expect(first).toBe('alpha');
    expect(loader).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);
    const second = await cache.get('key', loader);
    expect(second).toBe('alpha');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('refreshes values once the ttl expires', async () => {
    vi.useFakeTimers();
    const cache = createAsyncCache({ ttlMs: 250, maxSize: 10 });
    const loader = vi.fn()
      .mockResolvedValueOnce('initial')
      .mockResolvedValueOnce('refreshed');

    const first = await cache.get('symbol', loader);
    expect(first).toBe('initial');

    vi.advanceTimersByTime(500);
    const second = await cache.get('symbol', loader);
    expect(second).toBe('refreshed');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent loader calls', async () => {
    const cache = createAsyncCache({ ttlMs: 5_000, maxSize: 10 });
    let resolver;
    const loader = vi.fn().mockImplementation(
      () => new Promise((resolve) => {
        resolver = resolve;
      }),
    );

    const promiseA = cache.get('parallel', loader);
    const promiseB = cache.get('parallel', loader);

    expect(loader).toHaveBeenCalledTimes(1);

    resolver('done');

    const [valueA, valueB] = await Promise.all([promiseA, promiseB]);
    expect(valueA).toBe('done');
    expect(valueB).toBe('done');
  });

  it('evicts the oldest entries when the cache exceeds maxSize', async () => {
    const cache = createAsyncCache({ ttlMs: 0, maxSize: 2 });

    await cache.get('first', async () => 'A');
    await cache.get('second', async () => 'B');
    await cache.get('third', async () => 'C');

    expect(cache.size()).toBe(2);

    const loader = vi.fn().mockResolvedValue('A2');
    const value = await cache.get('first', loader);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(value).toBe('A2');
  });
});
