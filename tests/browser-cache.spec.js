import { describe, expect, it, vi } from 'vitest';
import { createRequestCache } from '../utils/browser-cache.js';

describe('createRequestCache', () => {
  it('tracks hits, misses and stale entries while respecting a custom clock', () => {
    let current = 1_000;
    const cache = createRequestCache({
      ttl: 50,
      maxEntries: 3,
      now: () => current,
    });

    cache.set('alpha', 42);
    expect(cache.get('alpha')).toBe(42);
    expect(cache.get('missing')).toBeUndefined();

    let stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.stale).toBe(0);
    expect(stats.size).toBe(1);

    current += 100; // expire entry
    expect(cache.get('alpha')).toBeUndefined();

    stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(2);
    expect(stats.stale).toBe(1);
    expect(stats.size).toBe(0);
  });

  it('deduplicates concurrent loads and captures loader metrics', async () => {
    const cache = createRequestCache({ ttl: 500 });
    const loader = vi.fn(async () => 'value');

    const [first, second] = await Promise.all([
      cache.resolve('token', loader),
      cache.resolve('token', loader),
    ]);

    expect(first).toBe('value');
    expect(second).toBe('value');
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.get('token')).toBe('value');

    const stats = cache.stats();
    expect(stats.loads).toBe(1);
    expect(stats.revalidations).toBe(1);
    expect(stats.hits).toBe(1);
  });

  it('invokes eviction callbacks for capacity, expiry and manual clears', () => {
    const evictions = [];
    let current = 0;
    const cache = createRequestCache({
      ttl: 10,
      maxEntries: 1,
      now: () => current,
      onEvict: (payload) => evictions.push(payload),
    });

    cache.set('a', 'A');
    cache.set('b', 'B');

    expect(evictions).toHaveLength(1);
    expect(evictions[0]).toMatchObject({
      key: 'a',
      reason: 'capacity',
      value: 'A',
      hasValue: true,
      pending: false,
    });

    current += 20;
    cache.prune();

    expect(evictions).toHaveLength(2);
    expect(evictions[1]).toMatchObject({
      key: 'b',
      reason: 'expired',
      hasValue: true,
    });

    cache.set('c', 'C');
    cache.clear();

    expect(evictions).toHaveLength(3);
    expect(evictions[2]).toMatchObject({
      key: 'c',
      reason: 'clear',
      hasValue: true,
    });

    const stats = cache.stats();
    expect(stats.evictions).toBe(3);
    expect(stats.size).toBe(0);
  });

  it('supports zero-ttl bypasses and records loader failures', async () => {
    const cache = createRequestCache();

    await expect(
      cache.resolve(
        'volatile',
        async () => {
          throw new Error('fail');
        },
        0,
      ),
    ).rejects.toThrow('fail');

    const stats = cache.stats();
    expect(stats.loads).toBe(1);
    expect(stats.errors).toBe(1);
    expect(cache.get('volatile')).toBeUndefined();
  });
});
