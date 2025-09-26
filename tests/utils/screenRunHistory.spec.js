import { describe, expect, it } from 'vitest';
import { createRunHistoryStore } from '../../utils/screen-run-history.js';

const createMemoryStorage = () => {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      data.set(key, String(value));
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
};

describe('screen run history store', () => {
  it('records sanitized entries and enforces capacity', () => {
    const storage = createMemoryStorage();
    const store = createRunHistoryStore({ storage, maxEntries: 2 });

    store.record({
      timestamp: 100,
      universeCount: '5',
      matches: '2',
      durationMs: '42.9',
      filters: { minUpside: '10', sectors: 'Tech, Health Care' },
      sort: { key: 'momentum', direction: 'asc' },
      universeSample: ['AAPL', 'MSFT'],
      metrics: {
        count: 2,
        avgUpside: '12.3',
        sectorLeaders: [{ name: 'Technology', count: '2', weight: '0.5' }],
      },
    });

    store.record({
      timestamp: 200,
      universeCount: 10,
      matches: 3,
      errorCount: 1,
      universeSample: 'NVDA, AMD, GOOG',
      metrics: {},
    });

    store.record({
      timestamp: 50,
      universeCount: 1,
      matches: 1,
    });

    const entries = store.list();
    expect(entries).toHaveLength(2);
    expect(entries[0].timestamp).toBe(200);
    expect(entries[0].errorCount).toBe(1);
    expect(entries[0].metrics.count).toBe(0);
    expect(entries[0].universeSample).toEqual(['NVDA', 'AMD', 'GOOG']);

    const second = entries[1];
    expect(second.timestamp).toBe(100);
    expect(second.filters.minUpside).toBe(10);
    expect(second.filters.sectors).toEqual(['Tech', 'Health Care']);
    expect(second.sort).toEqual({ key: 'momentum', direction: 'asc' });
    expect(second.metrics.avgUpside).toBeCloseTo(12.3);
    expect(second.metrics.sectorLeaders[0]).toEqual({
      name: 'Technology',
      count: 2,
      weight: 0.5,
      averageUpside: null,
    });
  });

  it('provides immutable snapshots and supports clearing', () => {
    const storage = createMemoryStorage();
    const store = createRunHistoryStore({ storage });
    store.record({ timestamp: 10, universeCount: 1, matches: 1 });

    const snapshot = store.list();
    snapshot[0].filters.minUpside = 999;
    snapshot[0].universeSample.push('TSLA');

    const next = store.list();
    expect(next[0].filters.minUpside).not.toBe(999);
    expect(next[0].universeSample).toEqual([]);

    store.clear();
    expect(store.list()).toEqual([]);
  });
});
