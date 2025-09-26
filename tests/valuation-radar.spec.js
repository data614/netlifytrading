import { describe, it, expect } from 'vitest';
import { computeValuationScores } from '../utils/valuation-scorer.js';

describe('valuation radar scorer', () => {
  it('computes normalized scores from valuation fundamentals', () => {
    const result = computeValuationScores({
      price: 120,
      upside: 0.25,
      fundamentals: {
        metrics: {
          earningsPerShare: 6,
          revenuePerShare: 30,
        },
      },
    });

    expect(result.pe.ratio).toBeCloseTo(20, 1);
    expect(result.pe.score).toBeGreaterThan(0);
    expect(result.ps.ratio).toBeCloseTo(4, 1);
    expect(result.upside.percent).toBeCloseTo(25, 3);
    expect(result.composite.availableCount).toBe(3);
    expect(result.composite.score).toBeGreaterThan(0);
  });

  it('returns null scores when fundamental metrics are missing', () => {
    const result = computeValuationScores({});
    expect(result.pe.ratio).toBeNull();
    expect(result.pe.score).toBeNull();
    expect(result.ps.ratio).toBeNull();
    expect(result.upside.percent).toBeNull();
    expect(result.composite.availableCount).toBe(0);
    expect(result.composite.score).toBeNull();
  });

  it('ignores negative or zero earnings when computing P/E ratios', () => {
    const result = computeValuationScores({
      price: 90,
      upside: 0.1,
      fundamentals: {
        metrics: {
          earningsPerShare: -4,
          revenuePerShare: 15,
        },
      },
    });

    expect(result.pe.ratio).toBeNull();
    expect(result.pe.score).toBeNull();
    expect(result.ps.ratio).toBeCloseTo(6, 1);
    expect(result.composite.availableCount).toBe(2);
  });
});
