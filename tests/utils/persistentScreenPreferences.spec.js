import { describe, expect, it } from 'vitest';
import { createScreenPreferenceStore } from '../../utils/persistent-screen-preferences.js';

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
    clear: () => {
      data.clear();
    },
  };
};

describe('persistent screen preferences', () => {
  it('returns defaults when storage is empty', () => {
    const storage = createMemoryStorage();
    const store = createScreenPreferenceStore({
      storage,
      defaults: {
        universe: 'AAPL, MSFT',
        filters: {
          minUpside: '5',
          batchCap: '6',
        },
      },
    });

    const snapshot = store.load();
    expect(snapshot.universe).toBe('AAPL, MSFT');
    expect(snapshot.filters.minUpside).toBe('5');
    expect(snapshot.filters.batchCap).toBe('6');
    expect(snapshot.sort).toEqual({ key: 'upside', direction: 'desc' });
    expect(snapshot.lastRun).toBeNull();
  });

  it('persists sanitized updates and merges filters', () => {
    const storage = createMemoryStorage();
    const store = createScreenPreferenceStore({ storage });

    store.save({
      universe: 'TSLA, SHOP',
      filters: {
        minUpside: '12',
        sectors: 'tech',
        batchCap: 12,
      },
      sort: { key: 'momentum', direction: 'asc' },
      lastRun: {
        timestamp: 100,
        universeCount: 5.8,
        matchesCount: 2.2,
        reachedCap: true,
        durationMs: '45',
      },
    });

    const first = store.load();
    expect(first.filters.batchCap).toBe('12');
    expect(first.filters.minUpside).toBe('12');
    expect(first.sort).toEqual({ key: 'momentum', direction: 'asc' });
    expect(first.lastRun).toEqual({
      timestamp: 100,
      universeCount: 6,
      matchesCount: 2,
      reachedCap: true,
      durationMs: 45,
    });

    store.merge({
      filters: { maxUpside: '120' },
      sort: { direction: 'desc' },
    });

    const second = store.load();
    expect(second.filters.minUpside).toBe('12');
    expect(second.filters.maxUpside).toBe('120');
    expect(second.sort).toEqual({ key: 'momentum', direction: 'desc' });

    store.merge({ lastRun: null });
    expect(store.load().lastRun).toBeNull();
  });

  it('recovers gracefully from corrupt storage', () => {
    const storage = createMemoryStorage();
    const store = createScreenPreferenceStore({ storage });
    storage.setItem(store.key, '{not-json');
    const snapshot = store.load();
    expect(snapshot.universe).toBe('');
    expect(snapshot.filters.batchCap).toBe('');
  });
});
