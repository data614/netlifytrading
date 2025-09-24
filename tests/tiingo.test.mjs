import test from 'node:test';
import assert from 'node:assert/strict';
import { __testables } from '../netlify/functions/tiingo.js';

const {
  resolveSymbolRequests,
  generateMockSeries,
  normalizeQuote,
  normalizeCandle,
  minutesForInterval,
} = __testables;

test('resolveSymbolRequests parses exchange prefixes and suffixes', () => {
  const [asx] = resolveSymbolRequests('ASX:WOW', '');
  assert.equal(asx.symbol, 'WOW');
  assert.equal(asx.mic, 'XASX');

  const [london] = resolveSymbolRequests('BARC.L', '');
  assert.equal(london.symbol, 'BARC');
  assert.equal(london.mic, 'XLON');

  const dedup = resolveSymbolRequests('AAPL, aapl ,XNYS:AAPL', '');
  assert.ok(dedup.length >= 1);
  assert.ok(dedup.every((entry) => entry.symbol === 'AAPL'));
});

test('generateMockSeries returns ordered, positive candles', () => {
  const series = generateMockSeries('AAPL', 40, 'eod');
  assert.equal(series.length, 40);
  const dates = series.map((row) => new Date(row.date).getTime());
  const sorted = [...dates].sort((a, b) => a - b);
  assert.deepEqual(dates, sorted);
  series.forEach((row) => {
    assert.ok(row.close > 0, 'close should be positive');
    assert.ok(row.high >= row.low, 'high >= low');
  });
});

test('normalizeQuote fills missing fields with fallbacks', () => {
  const normalized = normalizeQuote({ ticker: 'AAPL', last: 190.23 }, 'AAPL', 'XNAS');
  assert.equal(normalized.symbol, 'AAPL');
  assert.equal(normalized.price, 190.23);
  assert.equal(normalized.currency, 'USD');
});

test('normalizeCandle infers prices and previous close', () => {
  const row = { close: 100, open: 95, high: 102, low: 94, volume: 1200 };
  const normalized = normalizeCandle(row, 'TEST', { close: 90 }, 'XNAS');
  assert.equal(normalized.symbol, 'TEST');
  assert.equal(normalized.close, 100);
  assert.equal(normalized.previousClose, 90);
});

test('minutesForInterval handles intraday buckets', () => {
  assert.equal(minutesForInterval('5min'), 5);
  assert.equal(minutesForInterval('30min'), 30);
  assert.equal(minutesForInterval('1hour'), 60);
});
