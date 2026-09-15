import test from 'node:test';
import assert from 'node:assert/strict';
import { replaySharedCapital } from './sharedCapitalReplay.mjs';

const bars = (symbol) => ({ [symbol]: [{ t: 1, o: 100, c: 100 }, { t: 2, o: 100, c: 110 }] });
const trade = (symbol) => ({ symbol, at: 1, exitAt: 2, entry: 100, exit: 110, risk: 10 });

test('fees reduce ending equity', () => {
  const free = replaySharedCapital(bars('A'), [trade('A')], { roundTripCostPct: 0 });
  const costly = replaySharedCapital(bars('A'), [trade('A')], { roundTripCostPct: 1 });
  assert.ok(costly.endingEquity < free.endingEquity);
});

test('same-time allocation is deterministic and capped', () => {
  const series = { ...bars('A'), ...bars('B'), ...bars('C') };
  const candidates = ['C', 'A', 'B'].map(trade);
  const result = replaySharedCapital(series, candidates, { maxPositions: 2 });
  assert.equal(result.maxConcurrentPositions, 2);
  assert.equal(result.skippedEntries, 1);
  assert.deepEqual(result.tradeLog.map((x) => x.symbol), ['A', 'B']);
});

test('zero-risk candidate cannot create a position', () => {
  const result = replaySharedCapital(bars('A'), [{ ...trade('A'), risk: 0 }]);
  assert.equal(result.closedTrades, 0);
  assert.equal(result.openPositions, 0);
});

test('idle cash and principal are not double counted', () => {
  const result = replaySharedCapital(bars('A'), [trade('A')], { roundTripCostPct: 0 });
  assert.ok(result.endingEquity > 100_000 && result.endingEquity < 102_000);
});
