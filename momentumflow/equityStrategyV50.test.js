import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseV50Playbook, evaluateEquityBasketV50, settleV50ShadowObservation } from './equityStrategyV50.js';

const bars = (start, finish, count = 13) => Array.from({ length: count }, (_, i) => ({
  o: start + (finish - start) * i / (count - 1),
  c: start + (finish - start) * i / (count - 1),
}));

test('V50 chooses momentum only from completed positive history', () => {
  const picked = chooseV50Playbook({ momentum: [0.1,0.2,0.1,0.2,0.1,0.2], reversion: [-0.2,-0.1,-0.2,-0.1,-0.2,-0.1] });
  assert.equal(picked.playbook, 'MOMENTUM');
});

test('V50 stays cash when neither expert clears edge', () => {
  const picked = chooseV50Playbook({ momentum: [0,0,0,0,0,0], reversion: [.01,.01,.01,.01,.01,.01] });
  assert.equal(picked.playbook, 'CASH');
});

test('V50 emits two opposing legs and does not chase a single symbol', () => {
  const symbols = ['SPY','QQQ','IWM','DIA','XLK','XLF','XLE','GLD','TLT'];
  const barsBySymbol = Object.fromEntries(symbols.map((s, i) => [s, bars(100, 100 + i)]));
  const assetsBySymbol = Object.fromEntries(symbols.map((s) => [s, { shortable: true, easy_to_borrow: true }]));
  const result = evaluateEquityBasketV50({
    barsBySymbol,
    assetsBySymbol,
    expertHistory: { momentum: [0.2,0.2,0.2,0.2,0.2,0.2], reversion: [-0.2,-0.2,-0.2,-0.2,-0.2,-0.2] },
  });
  assert.equal(result.signal.strategy, 'EQUITY_V50_ADAPTIVE_PAIR');
  assert.equal(result.signal.legs.length, 2);
  assert.equal(result.signal.legs[0].direction, 'LONG');
  assert.equal(result.signal.legs[1].direction, 'SHORT');
});

test('V50 refuses a pair when the short leg cannot be borrowed', () => {
  const symbols = ['SPY','QQQ','IWM','DIA','XLK','XLF','XLE','GLD','TLT'];
  const barsBySymbol = Object.fromEntries(symbols.map((s, i) => [s, bars(100, 100 + i)]));
  const assetsBySymbol = Object.fromEntries(symbols.map((s) => [s, { shortable: true, easy_to_borrow: true }]));
  assetsBySymbol.SPY = { shortable: false, easy_to_borrow: false };
  const result = evaluateEquityBasketV50({
    barsBySymbol,
    assetsBySymbol,
    expertHistory: { momentum: [0.2,0.2,0.2,0.2,0.2,0.2], reversion: [-0.2,-0.2,-0.2,-0.2,-0.2,-0.2] },
  });
  assert.equal(result.signal, null);
  assert.match(result.reason, /short leg unavailable/);
});

test('V50 shadow scoring includes modeled cost', () => {
  const result = settleV50ShadowObservation({ highEntry: 100, highExit: 101, lowEntry: 100, lowExit: 100 });
  assert.equal(result.momentum, 0.44);
  assert.equal(result.reversion, -0.56);
});
