import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveCryptoV51State,
  buildCryptoV51Observation,
  settleCryptoV51Observation,
  shouldSampleCryptoV51,
  summarizeCryptoV51,
} from './cryptoForwardLearningV51.js';

const result = (metrics = {}) => ({ diagnostics: { metrics: { volumeRatio: 1, ...metrics } } });

test('V51 rewards accelerating persistent relative strength', () => {
  const strong = deriveCryptoV51State(result({ ret1hPct: 2, ret6hPct: 3, ret24hPct: 5, relative6hPct: 2, relative24hPct: 3, volumeRatio: 2, spreadPct: 0.1 }));
  const weak = deriveCryptoV51State(result({ ret1hPct: -1, ret6hPct: -3, ret24hPct: -5, relative6hPct: -2, relative24hPct: -3, volumeRatio: 0.6, spreadPct: 0.5 }));
  assert.ok(strong.opportunityScore > weak.opportunityScore);
  assert.ok(strong.acceleration > 0);
  assert.equal(strong.persistence, 1);
});

test('V51 observation is forward-only and initially pending', () => {
  const row = buildCryptoV51Observation({ symbol: 'BTC/USD', price: 100, observedAt: '2026-09-06T20:00:00.000Z', v35Result: result({ ret1hPct: 1, ret6hPct: 2, ret24hPct: 3, relative6hPct: 1, relative24hPct: 1, volumeRatio: 1.5 }) });
  assert.equal(row.status, 'pending');
  assert.equal(row.entryPrice, 100);
  assert.equal(row.forwardReturnPct, undefined);
});

test('V51 settles only after a future price is supplied', () => {
  const row = buildCryptoV51Observation({ symbol: 'ETH/USD', price: 100, v35Result: result({ ret1hPct: 1, ret6hPct: 2, ret24hPct: 3, relative6hPct: 1, relative24hPct: 1, volumeRatio: 2 }) });
  const settled = settleCryptoV51Observation(row, 102);
  assert.equal(settled.status, 'settled');
  assert.equal(settled.forwardReturnPct, 2);
});

test('V51 sampling cadence prevents duplicate rapid observations', () => {
  const now = Date.parse('2026-09-06T20:10:00.000Z');
  const rows = [{ symbol: 'BTC/USD', observedAt: '2026-09-06T20:08:00.000Z' }];
  assert.equal(shouldSampleCryptoV51(rows, 'BTC/USD', now), false);
  assert.equal(shouldSampleCryptoV51(rows, 'ETH/USD', now), true);
});

test('V51 summary reports forward favorable samples', () => {
  const rows = [
    { status: 'settled', hypothesis: 'FAVORABLE_LONG', forwardReturnPct: 2 },
    { status: 'settled', hypothesis: 'FAVORABLE_LONG', forwardReturnPct: -1 },
    { status: 'pending', hypothesis: 'NO_EDGE' },
  ];
  const s = summarizeCryptoV51(rows);
  assert.equal(s.favorableSamples, 2);
  assert.equal(s.favorableWinRate, 0.5);
  assert.equal(s.favorableAverageForwardReturnPct, 0.5);
});
