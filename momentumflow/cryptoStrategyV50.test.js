import test from 'node:test';
import assert from 'node:assert/strict';
import { cryptoV50PriceAction } from './cryptoStrategyV50.js';

const bar = (o, h, l, c) => ({ o, h, l, c });

test('V50 recognizes a bullish engulfing confirmation', () => {
  const rows = Array.from({ length: 8 }, () => bar(100, 101, 99, 100));
  rows.push(bar(101, 102, 98, 99), bar(98.5, 102, 98, 101.5));
  const result = cryptoV50PriceAction(rows);
  assert.equal(result.confirmed, true);
  assert.ok(result.patterns.includes('BULLISH_ENGULFING'));
});

test('V50 recognizes a swept low that closes back above support', () => {
  const rows = Array.from({ length: 9 }, (_, i) => bar(100 + i * .1, 101, 99, 100));
  rows.push(bar(98.5, 101, 98, 100.5));
  const result = cryptoV50PriceAction(rows);
  assert.equal(result.confirmed, true);
  assert.ok(result.patterns.includes('LOW_SWEEP_RECLAIM'));
});

test('V50 rejects ordinary noise without confirmation', () => {
  const rows = Array.from({ length: 10 }, (_, i) => bar(100, 101, 99, 100 + i * .01));
  const result = cryptoV50PriceAction(rows);
  assert.equal(result.confirmed, false);
});
