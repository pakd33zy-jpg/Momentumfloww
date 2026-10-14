import test from 'node:test';
import assert from 'node:assert/strict';
import { cryptoExitSellPreflight } from './cryptoExitSellPreflight.js';

test('blocks absent crypto holdings even when session says trade is open', () => {
  const p = cryptoExitSellPreflight({ market: 'BTC/USD', requestedQty: '0.15', positions: [] });
  assert.deepEqual(p, { allowed: false, reason: 'no-broker-position' });
});

test('clamps to sellable balance and formats to supported precision', () => {
  const p = cryptoExitSellPreflight({
    market: 'BTC/USD', requestedQty: '0.15',
    positions: [{ symbol: 'BTCUSD', qty: '0.15', qty_available: '0.149999999' }],
  });
  assert.equal(p.allowed, true);
  assert.equal(p.qty, '0.149999999');
});

test('zero available balance never falls back to a full sell', () => {
  const p = cryptoExitSellPreflight({
    market: 'SOL/USD', requestedQty: 4, positions: [{ symbol: 'SOLUSD', qty: '4', qty_available: '0' }],
  });
  assert.equal(p.allowed, false);
  assert.equal(p.reason, 'no-available-crypto-to-sell');
});

test('negative broker position cannot be closed by a sell', () => {
  const p = cryptoExitSellPreflight({
    market: 'ETH/USD', requestedQty: 2, positions: [{ symbol: 'ETHUSD', qty: '-2', qty_available: '2' }],
  });
  assert.equal(p.allowed, false);
  assert.equal(p.reason, 'non-long-broker-position');
});

test('short precision and bad session request fail closed', () => {
  assert.equal(cryptoExitSellPreflight({
    market: 'BTCUSD', requestedQty: 0.0000000001,
    positions: [{ symbol: 'BTCUSD', qty: '1' }],
  }).reason, 'below-supported-crypto-precision');
  assert.equal(cryptoExitSellPreflight({market: 'BTCUSD', requestedQty: 'bad', positions: []}).allowed, false);
});
