import { describe, it, expect } from 'vitest';
import buildValuationSnapshot, {
  computeGrowthRate,
  discountedCashFlow,
  summarizeValuationNarrative,
} from '../netlify/functions/lib/valuation.js';

describe('valuation utilities', () => {
  it('computes growth rate band', () => {
    const growth = computeGrowthRate({ revenueGrowth: 0.12, epsGrowth: 0.1, fcfGrowth: 0.08 });
    expect(growth.base).toBeGreaterThan(0.09);
    expect(growth.bull).toBeGreaterThan(growth.base);
    expect(growth.bear).toBeLessThan(growth.base);
  });

  it('computes discounted cash flow present value', () => {
    const pv = discountedCashFlow({ startingCashFlow: 5, growthRate: 0.1, discountRate: 0.08, years: 5, terminalGrowth: 0.03 });
    expect(pv).toBeGreaterThan(0);
    expect(pv).toBeGreaterThan(5);
  });

  it('produces valuation snapshot with fair value and margin of safety', () => {
    const snapshot = buildValuationSnapshot({
      price: 150,
      earningsPerShare: 6,
      revenuePerShare: 50,
      freeCashFlowPerShare: 4,
      bookValuePerShare: 25,
      revenueGrowth: 0.08,
      epsGrowth: 0.1,
      fcfGrowth: 0.07,
      discountRate: 0.09,
    });

    expect(snapshot.fairValue).toBeGreaterThan(0);
    expect(snapshot.suggestedEntry).toBeLessThan(snapshot.fairValue);
    expect(snapshot.marginOfSafety).toBe(0.15);
  });

  it('summarizes valuation narrative with upside details', () => {
    const snapshot = buildValuationSnapshot({
      price: 100,
      earningsPerShare: 5,
      revenuePerShare: 40,
      freeCashFlowPerShare: 4,
      bookValuePerShare: 20,
      revenueGrowth: 0.05,
      epsGrowth: 0.06,
      fcfGrowth: 0.04,
    });
    const narrative = summarizeValuationNarrative('TEST', snapshot);
    expect(narrative).toContain('TEST');
    expect(narrative).toMatch(/fair value/i);
  });
});
