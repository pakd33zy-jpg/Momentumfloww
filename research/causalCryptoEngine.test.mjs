import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPersistentBreakoutTrades, tradeStats } from './causalCryptoEngine.mjs';

const DAY = 86_400_000;
function fixture(length = 300) {
  return Array.from({ length }, (_, i) => ({ t: i * DAY, o: 100, h: 101, l: 99, c: 100, v: 1_000 }));
}

test('exclusive boundary is removed before indicators and execution', () => {
  const bars = fixture();
  assert.equal(buildPersistentBreakoutTrades(bars, { exclusiveEnd: 250 * DAY }).bars.length, 250);
});

test('breakout confirmation enters at next contiguous open', () => {
  const bars = fixture();
  bars[250] = { ...bars[250], c: 110, h: 111 };
  bars[251] = { ...bars[251], o: 112, h: 113, l: 111, c: 112 };
  const result = buildPersistentBreakoutTrades(bars);
  const position = result.trades[0] ?? result.open;
  assert.equal(position?.at, 251 * DAY);
  assert.equal(position?.entry, 112);
});

test('pending signal cannot cross a missing daily bar', () => {
  const bars = fixture();
  bars[250] = { ...bars[250], c: 110, h: 111 };
  for (let i = 251; i < bars.length; i++) bars[i].t += DAY;
  const result = buildPersistentBreakoutTrades(bars);
  assert.notEqual(result.open?.at, 252 * DAY);
});

test('adverse gap fills at open instead of optimistic stop', () => {
  const bars = fixture(310);
  bars[250] = { ...bars[250], c: 110, h: 111 };
  bars[251] = { ...bars[251], o: 112, h: 113, l: 111, c: 112 };
  bars[252] = { ...bars[252], o: 80, h: 81, l: 79, c: 80 };
  const result = buildPersistentBreakoutTrades(bars);
  assert.equal(result.trades[0].exit, 80);
});

test('costs cannot improve trade statistics', () => {
  const trades = [{ rawPct: 2 }, { rawPct: -1 }];
  assert.ok(tradeStats(trades, 1.5).netReturnPoints < tradeStats(trades, 0.5).netReturnPoints);
});
