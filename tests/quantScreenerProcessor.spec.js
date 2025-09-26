import { describe, expect, it, vi } from 'vitest';
import { computeRow, passesFilters, screenUniverse } from '../utils/quant-screener-core.js';

const buildPayload = ({ price, fairValue, marketCap = 1_000_000_000, sector = 'Technology' }) => ({
  valuation: {
    valuation: {
      price,
      fairValue,
    },
    fundamentals: {
      sector,
      metrics: {},
    },
  },
  overview: {
    marketCap,
    sector,
  },
});

describe('screenUniverse', () => {
  it('processes a small universe sequentially and applies filters', async () => {
    const universe = ['AAA', 'BBB', 'CCC'];
    const payloads = {
      AAA: buildPayload({ price: 100, fairValue: 130 }),
      BBB: buildPayload({ price: 100, fairValue: 108 }),
      CCC: buildPayload({ price: 200, fairValue: 260 }),
    };

    const filters = {
      minUpside: 10,
      maxUpside: null,
      marketCapMin: null,
      marketCapMax: null,
      sectors: [],
      batchCap: 6,
    };

    const sequence = [];
    const matches = [];

    const result = await screenUniverse(universe, {
      fetchIntel: async (symbol) => ({ data: payloads[symbol] }),
      computeRow,
      passesFilters: (row) => passesFilters(row, filters),
      filters,
      batchCap: filters.batchCap,
      concurrency: 1,
      onItemComplete: ({ row, passes }) => {
        sequence.push(row.symbol);
        if (passes) {
          matches.push(row.symbol);
        }
      },
    });

    expect(sequence).toEqual(['AAA', 'BBB', 'CCC']);
    expect(matches).toEqual(['AAA', 'CCC']);
    expect(result.matches.map((row) => row.symbol)).toEqual(['AAA', 'CCC']);
    expect(result.processed.map((row) => row.symbol)).toEqual(['AAA', 'BBB', 'CCC']);
    expect(result.reachedCap).toBe(false);
  });

  it('handles large universes with batched concurrency', async () => {
    const universe = Array.from({ length: 18 }, (_, index) => `SYM${index + 1}`);
    let active = 0;
    let maxActive = 0;

    const fetchIntel = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return { data: buildPayload({ price: 90, fairValue: 120 }) };
    });

    const filters = {
      minUpside: null,
      maxUpside: null,
      marketCapMin: null,
      marketCapMax: null,
      sectors: [],
      batchCap: universe.length + 5,
    };

    const result = await screenUniverse(universe, {
      fetchIntel,
      computeRow,
      passesFilters: () => true,
      filters,
      batchCap: filters.batchCap,
      concurrency: 5,
    });

    expect(fetchIntel).toHaveBeenCalledTimes(universe.length);
    expect(result.matches).toHaveLength(universe.length);
    expect(result.processed).toHaveLength(universe.length);
    expect(maxActive).toBeGreaterThan(1);
    expect(result.reachedCap).toBe(false);
  });
});
