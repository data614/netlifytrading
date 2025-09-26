import { describe, expect, it } from 'vitest';
import { computeAggregateMetrics, createEmptyAggregateMetrics } from '../../utils/quant-screener-analytics.js';

describe('quant screener analytics', () => {
  it('returns empty metrics when rows are missing', () => {
    const baseline = createEmptyAggregateMetrics();
    const metrics = computeAggregateMetrics();
    expect(metrics).toEqual({ ...baseline, sectorLeaders: [] });
    expect(metrics.count).toBe(0);
    expect(metrics.sectorLeaders).toEqual([]);
  });

  it('aggregates upside, momentum, and sectors', () => {
    const rows = [
      {
        symbol: 'AAPL',
        upside: 10,
        momentum: 5,
        marketCap: 2_000_000_000_000,
        sector: 'Technology',
      },
      {
        symbol: 'MSFT',
        upside: -5,
        momentum: 2,
        marketCap: 1_800_000_000_000,
        sector: 'Technology',
      },
      {
        symbol: 'JPM',
        upside: 0,
        momentum: null,
        marketCap: 400_000_000_000,
        sector: 'Financials',
      },
    ];

    const metrics = computeAggregateMetrics(rows);
    expect(metrics.count).toBe(3);
    expect(metrics.positiveUpsideCount).toBe(1);
    expect(metrics.negativeUpsideCount).toBe(1);
    expect(metrics.zeroUpsideCount).toBe(1);
    expect(metrics.bestUpside).toEqual({ symbol: 'AAPL', value: 10 });
    expect(metrics.worstUpside).toEqual({ symbol: 'MSFT', value: -5 });
    expect(metrics.bestMomentum).toEqual({ symbol: 'AAPL', value: 5 });
    expect(metrics.avgUpside).toBeCloseTo((10 - 5 + 0) / 3, 5);
    expect(metrics.medianUpside).toBeCloseTo(0, 5);
    expect(metrics.totalMarketCap).toBe(4_200_000_000_000);
    expect(metrics.averageMarketCap / 1_000_000_000_000).toBeCloseTo(1.4, 5);
    expect(metrics.sectorLeaders.length).toBe(2);
    const [tech, financials] = metrics.sectorLeaders;
    expect(tech.name).toBe('Technology');
    expect(tech.count).toBe(2);
    expect(tech.weight).toBeCloseTo(2 / 3, 5);
    expect(tech.averageUpside).toBeCloseTo((10 - 5) / 2, 5);
    expect(financials.name).toBe('Financials');
    expect(financials.count).toBe(1);
    expect(financials.weight).toBeCloseTo(1 / 3, 5);
  });
});
