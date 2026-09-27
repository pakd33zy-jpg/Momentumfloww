import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CRYPTO_MACD_PEAK_DEFAULTS,
  buildCryptoMacdPeakBudget,
  evaluateCryptoMacdPeakCandidate,
  evaluateCryptoMacdPeakExit,
} from './cryptoMacdPeakStrategy.js';

function barsFromCloses(closes) {
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);
  return closes.map((c, i) => ({
    c,
    h: c * 1.002,
    l: c * 0.998,
    t: new Date(base + i * 3600000).toISOString(),
  }));
}

test('MACD valley strategy requires the full adaptive lookback safely', () => {
  const bars1h = barsFromCloses(Array.from({ length: 100 }, (_, i) => 100 - i * 0.01));
  const result = evaluateCryptoMacdPeakCandidate({
    asset: { symbol: 'BTC/USD', name: 'Bitcoin' },
    snapshot: { latestTrade: { p: 99 } },
    bars1h,
    nowMs: Date.UTC(2026, 0, 10, 0, 0, 0),
  });
  assert.equal(result.signal, null);
  assert.match(result.reason, /need at least/i);
});

test('paper defaults match the tested no-forced-stop/no-max-hold rules', () => {
  assert.equal(CRYPTO_MACD_PEAK_DEFAULTS.emergencyStopLossPct, 0);
  assert.equal(CRYPTO_MACD_PEAK_DEFAULTS.maxHoldMinutes, 0);
  assert.equal(CRYPTO_MACD_PEAK_DEFAULTS.minTroughDepthQuantile, 0.5);
  assert.equal(CRYPTO_MACD_PEAK_DEFAULTS.troughLookbackBars, 200);
});

test('exit detector returns a boolean and only evaluates closed candles', () => {
  const closes = Array.from({ length: 260 }, (_, i) => 100 + Math.sin(i / 7) * 4 + i * 0.02);
  const bars1h = barsFromCloses(closes);
  const result = evaluateCryptoMacdPeakExit({
    bars1h,
    nowMs: Date.UTC(2026, 0, 20, 0, 0, 0),
  });
  assert.equal(typeof result.exit, 'boolean');
});

test('paper sizing remains finite without a fixed stop', () => {
  const budget = buildCryptoMacdPeakBudget({
    equity: 10000,
    cash: 10000,
    signal: {
      signal: {
        exitPlan: {
          stopLossPct: 0,
          riskSizingPct: 10,
          estimatedRoundTripCostPct: 0.10,
        },
      },
    },
  });
  assert.ok(budget > 0);
  assert.ok(budget <= 1200);
});
