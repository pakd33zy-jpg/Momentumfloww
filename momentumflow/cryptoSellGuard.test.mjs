import test from 'node:test';
import assert from 'node:assert/strict';
import { safeCryptoSellQuantity } from './cryptoSellGuard.js';

test('crypto close caps to broker available quantity after partial fill', () => {
 const v = safeCryptoSellQuantity({ symbol: 'BTC/USD', trackedQty: 2,
   brokerPositions: [{ symbol: 'BTCUSD', qty: '1.5', qty_available: '0.3' }] });
 assert.equal(v.allowed, true);
 assert.equal(v.qty, 0.3);
});

test('explicit zero available crypto does not fall back to tracked quantity', () => {
 const v = safeCryptoSellQuantity({ symbol: 'ETH/USD', trackedQty: 1,
   brokerPositions: [{ symbol: 'ETHUSD', qty: '1', qty_available: '0' }] });
 assert.equal(v.allowed, false);
 assert.equal(v.reason, 'no-available-holdings');
 assert.equal(v.qty, 0);
});

test('missing broker position blocks a sell', () => {
 const v = safeCryptoSellQuantity({ symbol: 'SOL/USD', trackedQty: 50,
   brokerPositions: [{ symbol: 'BTC/USD', qty: '12' }] });
 assert.equal(v.allowed, false);
 assert.equal(v.reason, 'no-broker-position');
});

test('missing qty_available falls back to broker position qty, never above it', () => {
 const v = safeCryptoSellQuantity({ symbol: 'ETH/USD', trackedQty: 3,
   brokerPositions: [{ symbol: 'ETH/USD', qty: '1.25' }] });
 assert.equal(v.allowed, true);
 assert.equal(v.qty, 1.25);
});

test('invalid broker holdings block exit instead of allowing a short', () => {
 const v = safeCryptoSellQuantity({ symbol: 'ETH/USD', trackedQty: 3,
   brokerPositions: [{ symbol: 'ETH/USD', qty: '-1', qty_available: '10' }] });
 assert.equal(v.allowed, false);
 assert.equal(v.reason, 'no-positive-holdings');
});

test('lower tracked quantity is preserved when broker has more holdings', () => {
 const v = safeCryptoSellQuantity({ symbol: 'ETH/USD', trackedQty: 0.02,
   brokerPositions: [{ symbol: 'ETH/USD', qty: '12', qty_available: '12' }] });
 assert.equal(v.allowed, true);
 assert.equal(v.qty, 0.02);
});
