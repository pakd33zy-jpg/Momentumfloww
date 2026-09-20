import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCryptoBreadth, breadthExpansionGate, relativeStrengthRanks } from './cryptoBreadth.mjs';

const series = (closes) => closes.map((c, i) => ({ t: i, c }));

test('breadth uses only observations available at each timestamp', () => {
  const breadth = buildCryptoBreadth({ A: series([1, 1, 2]), B: series([1, 1, 0.5]) }, 2);
  assert.equal(breadth.get(0).eligible, 0);
  assert.equal(breadth.get(2).eligible, 2);
  assert.equal(breadth.get(2).above, 1);
});

test('breadth gate requires both threshold and expansion', () => {
  const breadth = new Map([[1, { eligible: 10, fraction: 0.5 }], [2, { eligible: 10, fraction: 0.7 }]]);
  assert.equal(breadthExpansionGate(breadth, 2, 1, 0.6), true);
  assert.equal(breadthExpansionGate(breadth, 2, 1, 0.8), false);
});

test('relative-strength rank excludes benchmark and is deterministic', () => {
  const ranked = relativeStrengthRanks({
    'BTC/USD': series([100, 105, 110]),
    'ETH/USD': series([100, 120, 140]),
    'SOL/USD': series([100, 110, 120]),
  }, 2, 1);
  assert.deepEqual(ranked.map((x) => x.symbol), ['ETH/USD', 'SOL/USD']);
});
