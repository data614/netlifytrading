import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyseSeries,
  annualizeVolatility,
  computeReturns,
  maxDrawdown,
  movingAverage,
  relativeStrengthIndex,
  formatPercent,
} from '../shared/quant.js';

const buildSeries = () => {
  const start = new Date('2024-01-02T00:00:00Z').getTime();
  const points = [];
  for (let i = 0; i < 60; i += 1) {
    const date = new Date(start + i * 24 * 60 * 60 * 1000).toISOString();
    const close = 100 + Math.sin(i / 6) * 4 + i * 0.4;
    const volume = 1_000_000 + (i % 5) * 50_000;
    points.push({ date, close, volume });
  }
  return points;
};

test('analyseSeries returns robust technical metrics', () => {
  const series = buildSeries();
  const metrics = analyseSeries(series, { periodsPerYear: 252 });
  assert.ok(metrics.volatility > 0);
  assert.ok(Number.isFinite(metrics.sharpe));
  assert.ok(metrics.drawdown < 0);
  assert.ok(metrics.averageVolume > 0);
  assert.ok(metrics.sma20 > 0 && metrics.sma50 > 0);
  assert.ok(metrics.rsi >= 0 && metrics.rsi <= 100);
});

test('movingAverage aligns with computeReturns and volatility', () => {
  const series = buildSeries();
  const closes = series.map((row) => row.close);
  const ma = movingAverage(closes, 10);
  assert.equal(ma.length, closes.length);
  const returns = computeReturns(series);
  const vol = annualizeVolatility(returns, 252);
  assert.ok(vol > 0);
  const dd = maxDrawdown(closes);
  assert.ok(dd <= 0);
  const rsi = relativeStrengthIndex(closes, 14);
  assert.ok(rsi >= 0 && rsi <= 100);
});

test('formatPercent handles null safely', () => {
  assert.equal(formatPercent(0.1234, 1), '12.3%');
  assert.equal(formatPercent(null), '—');
});
