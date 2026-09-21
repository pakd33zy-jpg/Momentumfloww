import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateEquityV71,
  evaluateV71Symbol,
  nextBarOpen,
  settleV71ShadowTrade,
  timedExitClose,
} from './equityStrategyV71.js';

const start = Date.parse('2026-09-21T15:00:00Z'); // 11:00 ET
const bars = Array.from({ length: 12 }, (_, i) => {
  const c = 100 + i * 0.32;
  return { t: new Date(start + i * 30 * 60_000).toISOString(), o: c - 0.08, h: c + 0.22, l: c - 0.18, c };
});

test('V71 requires the exact late-day completed-bar window', () => {
  const at1300 = start + 4 * 30 * 60_000;
  assert.equal(evaluateV71Symbol(bars, at1300).qualifies, true);
  assert.equal(evaluateV71Symbol(bars, start + 3 * 30 * 60_000).qualifies, false);
});

test('V71 requires synchronized SPY confirmation and ranks alignment', () => {
  const signalTimestamp = start + 4 * 30 * 60_000;
  const result = evaluateEquityV71({
    signalTimestamp,
    barsBySymbol: { SPY: bars, QQQ: bars, IWM: bars },
    config: { symbols: ['SPY', 'QQQ', 'IWM'], maxPositions: 2 },
  });
  assert.equal(result.signals.length, 2);
  assert.ok(result.signals.every((x) => x.direction === 'LONG'));
});

test('V71 uses next-bar open and the fourth later bar close', () => {
  const signalTimestamp = start + 4 * 30 * 60_000;
  assert.equal(nextBarOpen(bars, signalTimestamp).timestamp, start + 5 * 30 * 60_000);
  assert.equal(timedExitClose(bars, signalTimestamp).timestamp, start + 8 * 30 * 60_000);
});

test('V71 settlement subtracts modeled round-trip cost', () => {
  assert.equal(settleV71ShadowTrade({ entryPrice: 100, exitPrice: 101 }), 0.94);
});
