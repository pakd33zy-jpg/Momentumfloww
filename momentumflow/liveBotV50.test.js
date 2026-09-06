import test from 'node:test';
import assert from 'node:assert/strict';
import { executeV50PairedEntry, filledEntryLeg } from './liveBotV50.js';

const signal = {
  legs: [
    { symbol: 'XLK', direction: 'LONG', price: 100 },
    { symbol: 'XLE', direction: 'SHORT', price: 50 },
  ],
};

test('filledEntryLeg preserves partial exposure for rollback', () => {
  const leg = filledEntryLeg(signal.legs[0], { id: 'one', status: 'canceled', filled_qty: '2.5', filled_avg_price: '101' });
  assert.equal(leg.qty, 2.5);
  assert.equal(leg.entryStatus, 'canceled');
});

test('paired entry returns exactly two completely filled legs', async () => {
  let id = 0;
  const opened = await executeV50PairedEntry({
    signal,
    budget: 1000,
    submit: async () => ({ id: String(++id) }),
    settleOrder: async (orderId) => ({ id: orderId, status: 'filled', filled_qty: '10', filled_avg_price: '100' }),
    undo: async () => assert.fail('rollback should not run'),
  });
  assert.equal(opened.length, 2);
});

test('second-leg rejection rolls back the first filled leg', async () => {
  let id = 0;
  let rolledBack;
  await assert.rejects(() => executeV50PairedEntry({
    signal,
    budget: 1000,
    submit: async () => ({ id: String(++id) }),
    settleOrder: async (orderId) => orderId === '1'
      ? { id: orderId, status: 'filled', filled_qty: '10', filled_avg_price: '100' }
      : { id: orderId, status: 'rejected', filled_qty: '0', filled_avg_price: null },
    undo: async (legs) => { rolledBack = legs; return legs; },
  }), /rollback completed/);
  assert.deepEqual(rolledBack.map((leg) => leg.symbol), ['XLK']);
});

test('partial second leg is included in rollback with the first leg', async () => {
  let id = 0;
  let rolledBack;
  await assert.rejects(() => executeV50PairedEntry({
    signal,
    budget: 1000,
    submit: async () => ({ id: String(++id) }),
    settleOrder: async (orderId) => orderId === '1'
      ? { id: orderId, status: 'filled', filled_qty: '10', filled_avg_price: '100' }
      : { id: orderId, status: 'canceled', filled_qty: '3', filled_avg_price: '50' },
    undo: async (legs) => { rolledBack = legs; return legs; },
  }), /XLE entry canceled \(3 filled\)/);
  assert.deepEqual(rolledBack.map((leg) => [leg.symbol, leg.qty]), [['XLK', 10], ['XLE', 3]]);
});

test('rollback failure is surfaced instead of claiming the pair is flat', async () => {
  let id = 0;
  await assert.rejects(() => executeV50PairedEntry({
    signal,
    budget: 1000,
    submit: async () => ({ id: String(++id) }),
    settleOrder: async (orderId) => orderId === '1'
      ? { id: orderId, status: 'filled', filled_qty: '10', filled_avg_price: '100' }
      : { id: orderId, status: 'rejected', filled_qty: '0', filled_avg_price: null },
    undo: async (legs) => legs.map((leg) => ({ ...leg, rollbackError: 'close rejected' })),
  }), /rollback incomplete/);
});
