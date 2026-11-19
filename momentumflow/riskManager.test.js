import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOrderRisk, sizePosition } from './riskManager.js';
import { PaperAdapterRegistry } from './paperAdapterRegistry.js';

const account = { equity: 10000, dailyPnl: 0, openPositions: [] };
const baseOrder = { mode: 'paper', symbol: 'BTC/USD', side: 'buy', quantity: 10, entryPrice: 100, stopPrice: 99 };

test('shared risk gate accepts a paper order inside every cap', () => {
  assert.equal(evaluateOrderRisk(baseOrder, account).allowed, true);
});
test('shared risk gate blocks live orders', () => {
  const result = evaluateOrderRisk({ ...baseOrder, mode: 'live' }, account);
  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(' '), /paper mode only/);
});
test('shared risk gate blocks a breached daily loss limit', () => {
  const result = evaluateOrderRisk(baseOrder, { ...account, dailyPnl: -200 });
  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(' '), /Daily loss limit/);
});
test('shared risk gate blocks oversized risk and duplicate symbols', () => {
  assert.equal(evaluateOrderRisk({ ...baseOrder, quantity: 100 }, account).allowed, false);
  assert.equal(evaluateOrderRisk(baseOrder, { ...account, openPositions: [{ symbol: 'BTC/USD', notional: 100 }] }).allowed, false);
});
test('sizing respects risk and notional limits', () => {
  const sized = sizePosition({ equity: 10000, entryPrice: 100, stopPrice: 98, riskPct: 0.005, maxPositionNotionalPct: 0.15 });
  assert.ok(sized.quantity > 0);
  assert.ok(sized.estimatedRisk <= 50);
  assert.ok(sized.notional <= 1500);
});
test('paper adapter registry rejects non-paper and incomplete adapters', () => {
  const registry = new PaperAdapterRegistry();
  assert.throws(() => registry.register('crypto', { mode: 'live' }), /Only paper-mode/);
  assert.throws(() => registry.register('crypto', { mode: 'paper' }), /missing getAccount/);
});
