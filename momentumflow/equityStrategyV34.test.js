import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EQUITY_V34_DEFAULTS,
  evaluateEquityCandidateV34,
  equityStrategyWindowOpenV34,
} from './equityStrategyV34.js';

const NOW = new Date('2026-08-26T14:20:00Z'); // 10:20 ET

function bars({
  start = 100,
  drift = 0.10,
  count = 50,
  volume = 120000,
  volumeBoost = 1.5,
} = {}) {
  const out = [];
  let px = start;
  for (let i = 0; i < count; i += 1) {
    const open = px;
    px = Math.max(1, px * (1 + drift / 100));
    const close = px;
    out.push({
      t: new Date(Date.parse('2026-08-26T13:30:00Z') + i * 60000).toISOString(),
      o: open,
      h: Math.max(open, close) * 1.0007,
      l: Math.min(open, close) * 0.9993,
      c: close,
      v: i === count - 1 ? volume * volumeBoost : volume,
    });
  }
  return out;
}

function snapshotFrom(rows, { spreadPct = 0.025, dayOpen = 98 } = {}) {
  const last = rows.at(-1);
  const mid = last.c;
  const half = mid * spreadPct / 200;
  return {
    latestTrade: { p: mid },
    latestQuote: { bp: mid - half, ap: mid + half },
    minuteBar: { ...last },
    dailyBar: { o: dayOpen, c: mid, v: 2500000 },
    prevDailyBar: { c: dayOpen, v: 2500000 },
  };
}

const longAsset = {
  symbol: 'TEST',
  shortable: true,
  easy_to_borrow: true,
};

test('V34 equity window is open during regular strategy hours', () => {
  assert.equal(equityStrategyWindowOpenV34({ now: NOW }), true);
});

test('strong aligned long setup qualifies without requiring every playbook', () => {
  const rows = bars({ drift: 0.12, volumeBoost: 1.8 });
  const result = evaluateEquityCandidateV34({
    asset: longAsset,
    snapshot: snapshotFrom(rows, { dayOpen: 98 }),
    bars: rows,
    marketRegime: 'bullish',
    intelligence: { netScore: 2.5, reasons: ['fresh customer contract'] },
    now: NOW,
    mode: 'paper',
  });

  assert.ok(result.signal, JSON.stringify(result.diagnostics));
  assert.equal(result.signal.strategy, 'EQUITY_V34_EVIDENCE');
  assert.equal(result.signal.direction, 'LONG');
  assert.ok(result.signal.score >= EQUITY_V34_DEFAULTS.equityV34ScoreThreshold);
  assert.ok(result.signal.signal.exitPlan.stopLossPct > 0);
});

test('bearish candidate is scored and can qualify short instead of becoming 0/10', () => {
  const rows = bars({ start: 105, drift: -0.13, volumeBoost: 1.7 });
  const result = evaluateEquityCandidateV34({
    asset: longAsset,
    snapshot: snapshotFrom(rows, { dayOpen: 110 }),
    bars: rows,
    marketRegime: 'bearish',
    intelligence: { netScore: -2.0, reasons: ['negative guidance'] },
    now: NOW,
    mode: 'paper',
  });

  assert.ok(Number.isFinite(result.diagnostics.long.score));
  assert.ok(Number.isFinite(result.diagnostics.short.score));
  assert.ok(result.diagnostics.short.score > result.diagnostics.long.score);
  assert.ok(result.signal, JSON.stringify(result.diagnostics));
  assert.equal(result.signal.direction, 'SHORT');
});

test('weak soft evidence produces a meaningful score rather than a hard 0/10', () => {
  const rows = bars({ drift: 0.005, volumeBoost: 0.55 });
  const result = evaluateEquityCandidateV34({
    asset: longAsset,
    snapshot: snapshotFrom(rows, { dayOpen: 100 }),
    bars: rows,
    marketRegime: 'neutral',
    intelligence: { netScore: 0 },
    now: NOW,
  });

  assert.equal(result.diagnostics.hardReject, false);
  assert.ok(Number.isFinite(result.diagnostics.long.score));
  assert.ok(result.diagnostics.long.score > 0);
});

test('truly untradeable spread hard-rejects with null score', () => {
  const rows = bars({ drift: 0.10 });
  const result = evaluateEquityCandidateV34({
    asset: longAsset,
    snapshot: snapshotFrom(rows, { spreadPct: 0.30 }),
    bars: rows,
    now: NOW,
  });

  assert.equal(result.signal, null);
  assert.equal(result.diagnostics.hardReject, true);
  assert.equal(result.diagnostics.score, null);
});

test('positive catalyst cannot force a long trade against strongly bearish tape', () => {
  const rows = bars({ start: 110, drift: -0.16, volumeBoost: 0.8 });
  const result = evaluateEquityCandidateV34({
    asset: longAsset,
    snapshot: snapshotFrom(rows, { dayOpen: 115 }),
    bars: rows,
    marketRegime: 'bearish',
    intelligence: { netScore: 5.0, reasons: ['government award'] },
    now: NOW,
    config: { equityV34ScoreThreshold: 6.3 },
  });

  assert.ok(Number.isFinite(result.diagnostics.long.score));
  assert.ok(result.diagnostics.long.score < 6.3);
  if (result.signal) assert.notEqual(result.signal.direction, 'LONG');
});

test('low relative volume is a penalty, not an automatic rejection', () => {
  const rows = bars({ drift: 0.16, volumeBoost: 0.55 });
  const result = evaluateEquityCandidateV34({
    asset: longAsset,
    snapshot: snapshotFrom(rows, { dayOpen: 96 }),
    bars: rows,
    marketRegime: 'bullish',
    intelligence: { netScore: 2.5 },
    now: NOW,
    config: { equityV34ScoreThreshold: 6.0 },
  });

  assert.ok(Number.isFinite(result.diagnostics.long.score));
  assert.ok(result.diagnostics.long.components.volume < 0);
  assert.ok(result.diagnostics.long.score > 0);
});
