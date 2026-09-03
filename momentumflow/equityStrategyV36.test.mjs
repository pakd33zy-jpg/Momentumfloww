import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEquityCandidateV36 } from './equityStrategyV36.js';

function barsFromReturns(returns, start = 100, volume = 100000) {
  const out = [];
  let p = start;
  for (let i = 0; i < returns.length; i += 1) {
    const open = p;
    p = p * (1 + returns[i] / 100);
    out.push({
      t: new Date(Date.UTC(2026, 0, 1, 14, 30 + i)).toISOString(),
      o: open,
      h: Math.max(open, p) * 1.001,
      l: Math.min(open, p) * 0.999,
      c: p,
      v: volume * (i === returns.length - 1 ? 1.8 : 1),
    });
  }
  return out;
}

const asset = { symbol: 'TEST', name: 'TEST', tradable: true, shortable: true, easy_to_borrow: true };

function snap(bars) {
  const p = bars.at(-1).c;
  return { latestTrade: { p }, latestQuote: { bp: p * 0.9997, ap: p * 1.0003 }, minuteBar: { c: p } };
}

test('V36 preserves coherent continuation evidence', () => {
  const bars = barsFromReturns([
    .02,.03,.01,.04,.02,.03,.04,.05,.04,.03,.05,.04,.06,.05,.04,.05,.06,.05,.04,.06,
    .07,.05,.06,.08,.07,.06,.08,.09,.08,.10,.09,.11,.10,.12,.11,.10,.12,.13,.12,.14
  ]);
  const result = evaluateEquityCandidateV36({ asset, bars, snapshot: snap(bars), marketRegime: { direction: 'LONG' } });
  assert.ok(result.signal, result.reason || 'expected signal');
  assert.equal(result.signal.signal.version, 'V36');
  assert.ok(result.signal.signal.v36Adjustment >= 0);
});

test('V36 treats regime conflict as soft evidence, not hard rejection', () => {
  const bars = barsFromReturns([
    .02,.03,.01,.04,.02,.03,.04,.05,.04,.03,.05,.04,.06,.05,.04,.05,.06,.05,.04,.06,
    .07,.05,.06,.08,.07,.06,.08,.09,.08,.10,.09,.11,.10,.12,.11,.10,.12,.13,.12,.14
  ]);
  const result = evaluateEquityCandidateV36({ asset, bars, snapshot: snap(bars), marketRegime: { direction: 'SHORT' } });
  assert.equal(result.diagnostics?.hardReject, false);
  assert.equal(result.diagnostics?.version, 'V36');
});

test('V36 penalizes mixed-horizon/choppy evidence without marking it invalid', () => {
  const returns = Array.from({ length: 45 }, (_, i) => i % 2 === 0 ? 0.22 : -0.20);
  const bars = barsFromReturns(returns);
  const result = evaluateEquityCandidateV36({
    asset,
    bars,
    snapshot: snap(bars),
    marketRegime: { direction: 'NEUTRAL' },
    config: { equityV35ScoreThreshold: 0, equityV36ScoreThreshold: 5.8 },
  });
  assert.equal(result.diagnostics?.hardReject, false);
  assert.equal(result.diagnostics?.version, 'V36');
});
