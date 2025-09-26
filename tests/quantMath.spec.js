import { describe, it, expect } from 'vitest';
import {
  priceToEarnings,
  priceToSales,
  debtToEquity,
  freeCashFlowYield,
  netDebtToEBITDA,
  returnOnEquity,
  toQuantNumber,
} from '../utils/quant-math.js';

describe('quantitative math utilities', () => {
  it('computes valuation multiples', () => {
    expect(priceToEarnings(100, 5)).toBeCloseTo(20);
    expect(priceToSales(120, 40)).toBeCloseTo(3);
  });

  it('computes leverage and profitability ratios', () => {
    expect(debtToEquity(200, 100)).toBeCloseTo(2);
    expect(netDebtToEBITDA(150, 50)).toBeCloseTo(3);
    expect(returnOnEquity(25, 125)).toBeCloseTo(0.2);
  });

  it('computes yield metrics', () => {
    expect(freeCashFlowYield(80, 4)).toBeCloseTo(0.05);
  });

  it('returns null when inputs invalid', () => {
    expect(priceToEarnings(100, 0)).toBeNull();
    expect(priceToSales('bad', 20)).toBeNull();
    expect(debtToEquity(50, null)).toBeNull();
    expect(netDebtToEBITDA(40, 0)).toBeNull();
    expect(returnOnEquity(undefined, 10)).toBeNull();
    expect(freeCashFlowYield(0, 4)).toBeNull();
    expect(toQuantNumber('not-a-number')).toBeNull();
  });
});
