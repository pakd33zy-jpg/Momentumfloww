import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCryptoCandidateV33,
  buildCryptoV33Budget,
} from './cryptoStrategyV33.js';

function bars(count, start, driftPct, timeframeMinutes, overrides = {}) {
  let price = start;
  return Array.from({ length: count }, (_, index) => {
    const prior = price;
    price *= 1 + driftPct / 100;
    const wiggle = Math.sin(index * 0.7) * 0.0015;
    const close = price * (1 + wiggle);
    return {
      t: new Date(Date.UTC(2026, 0, 1) + index * timeframeMinutes * 60000).toISOString(),
      o: prior,
      h: Math.max(prior, close) * 1.003,
      l: Math.min(prior, close) * 0.997,
      c: close,
      v: 1000 + index * 5,
      ...overrides[index],
    };
  });
}

function candidate({ spreadPct = 0.05, bearish = false, omitDaily = false } = {}) {
  const daily = bars(50, 80, bearish ? -0.18 : 0.28, 1440);
  const hourly = bars(1000, 70, bearish ? -0.015 : 0.025, 60);
  const fifteen = bars(70, 98, bearish ? -0.02 : 0.035, 15);
  if (!bearish) {
    // Create a shallow pullback followed by a reclaim of the 20-bar EMA.
    const base = fifteen.at(-4).c;
    fifteen.at(-3).c = base * 0.993;
    fifteen.at(-3).l = base * 0.990;
    fifteen.at(-2).c = base * 0.997;
    fifteen.at(-2).l = base * 0.994;
    fifteen.at(-1).c = base * 1.006;
    fifteen.at(-1).h = base * 1.008;
    fifteen.at(-1).v *= 1.5;
  }
  const price = fifteen.at(-1).c;
  const half = price * spreadPct / 200;
  return evaluateCryptoCandidateV33({
    asset: { symbol: 'BTC/USD', name: 'Bitcoin' },
    snapshot: { latestQuote: { bp: price - half, ap: price + half } },
    bars15m: fifteen,
    bars1h: hourly,
    bars1d: omitDaily ? [] : daily,
  });
}

test('qualifies an aligned liquid multi-timeframe pullback', () => {
  const result = candidate();
  assert.ok(result.signal, result.diagnostics?.reason);
  assert.equal(result.signal.strategy, 'CRYPTO_V33_TREND_PULLBACK');
  assert.ok(result.signal.signal.exitPlan.takeProfitPct > result.signal.signal.exitPlan.stopLossPct);
});

test('rejects a falling higher-timeframe market', () => {
  const result = candidate({ bearish: true });
  assert.equal(result.signal, null);
  assert.match(result.diagnostics.reason, /trend not aligned/);
});

test('rejects spread that makes execution poor', () => {
  const result = candidate({ spreadPct: 0.40 });
  assert.equal(result.signal, null);
  assert.match(result.diagnostics.reason, /spread/);
});

test('derives daily trend from hourly bars when Alpaca daily history is sparse', () => {
  const result = candidate({ omitDaily: true });
  assert.ok(result.signal, result.diagnostics?.reason);
  assert.equal(result.signal.signal.dailySource, 'derived_from_1Hour');
});

test('cash-aware sizing cannot exceed cash, symbol cap, or portfolio cap', () => {
  const signal = candidate().signal;
  assert.ok(signal);
  assert.ok(buildCryptoV33Budget({ equity: 100000, cash: 2000, signal }) <= 1900);
  assert.ok(buildCryptoV33Budget({ equity: 100000, cash: 50000, signal }) <= 12000);
  assert.equal(buildCryptoV33Budget({
    equity: 100000,
    cash: 50000,
    currentCryptoExposure: 35000,
    signal,
  }), 0);
});
