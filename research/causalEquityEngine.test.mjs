import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScoredEquityTrades, tradeStats } from './causalEquityEngine.mjs';

const DAY = 86_400_000;
const bars = (count = 280) => Array.from({ length: count }, (_, i) => {
  const c = 100 + i * 0.2;
  return { t: i * DAY, o: c - 0.05, h: c + 0.3, l: c - 0.3, c, v: 1_000 };
});

test('equity signal enters only at the following bar open', () => {
  const input = bars();
  input[250] = { ...input[250], c: 160, h: 160.2, v: 5_000 };
  input[251] = { ...input[251], o: 161, h: 170, l: 160.5, c: 168 };
  const result = buildScoredEquityTrades(input, { rewardRisk: 1 });
  assert.equal(result.trades[0].at, input[251].t);
  assert.equal(result.trades[0].entry, 161);
});

test('entry-bar stop is enforced before target when both are touched', () => {
  const input = bars();
  input[250] = { ...input[250], c: 160, h: 160.2, v: 5_000 };
  input[251] = { ...input[251], o: 161, h: 180, l: 140, c: 170 };
  const result = buildScoredEquityTrades(input);
  assert.equal(result.trades[0].reason, 'STOP');
  assert.ok(result.trades[0].rawPct < 0);
});

test('exclusive boundary prevents a future signal from leaking into results', () => {
  const input = bars();
  input[250] = { ...input[250], c: 160, h: 160.2, v: 5_000 };
  const result = buildScoredEquityTrades(input, { exclusiveEnd: input[250].t });
  assert.equal(result.trades.length, 0);
  assert.equal(result.pending, null);
});

test('downtrend can generate a causal short with positive signed return', () => {
  const input = bars().map((b, i) => ({ ...b, o: 200 - i * 0.2, h: 200.3 - i * 0.2, l: 199.7 - i * 0.2, c: 200 - i * 0.2 }));
  input[250] = { ...input[250], c: 140, l: 139.8, v: 5_000 };
  input[251] = { ...input[251], o: 139, h: 139.2, l: 120, c: 125 };
  const result = buildScoredEquityTrades(input, { rewardRisk: 1 });
  assert.equal(result.trades[0].direction, -1);
  assert.ok(result.trades[0].rawPct > 0);
});

test('reported statistics subtract modeled costs', () => {
  const stats = tradeStats([{ rawPct: 1 }, { rawPct: -0.5 }], 0.1);
  assert.ok(Math.abs(stats.netReturnPoints - 0.3) < 1e-12);
  assert.equal(stats.closedTrades, 2);
});
