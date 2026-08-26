import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCryptoCandidateV34,
  buildCryptoV34Budget,
} from './cryptoStrategyV34.js';

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

function evaluate({
  spreadPct = 0.05,
  bearish = false,
  omitDaily = false,
  recovery = false,
  exactPullback = true,
  intelligence = null,
} = {}) {
  const daily = bars(50, 80, bearish || recovery ? -0.50 : 0.28, 1440);
  if (recovery) {
    for (let index = daily.length - 8; index < daily.length; index += 1) {
      const prior = daily[index - 1].c;
      const next = prior * 1.012;
      daily[index] = {
        ...daily[index],
        o: prior,
        h: next * 1.003,
        l: prior * 0.997,
        c: next,
      };
    }
  }

  const hourly = bars(1000, 70, bearish ? -0.015 : 0.025, 60);
  const fifteen = bars(70, 98, bearish ? -0.02 : 0.035, 15);

  if (!bearish && exactPullback) {
    const base = fifteen.at(-4).c;
    fifteen.at(-3).c = base * 0.993;
    fifteen.at(-3).l = base * 0.990;
    fifteen.at(-2).c = base * 0.997;
    fifteen.at(-2).l = base * 0.994;
    fifteen.at(-1).c = base * 1.006;
    fifteen.at(-1).h = base * 1.008;
    fifteen.at(-1).v *= 1.5;
  } else if (!bearish) {
    // A true continuation fixture: no pullback/reclaim pattern, but the latest
    // hour is actually advancing. Do not make the strategy buy a falling tape
    // merely to satisfy this test.
    const base = fifteen.at(-6).c;
    for (let step = 1; step <= 5; step += 1) {
      const index = fifteen.length - 6 + step;
      const prior = step === 1 ? base : fifteen[index - 1].c;
      const next = base * (1 + step * 0.0035);
      fifteen[index] = {
        ...fifteen[index],
        o: prior,
        h: next * 1.002,
        l: prior * 0.998,
        c: next,
        v: fifteen[index].v * 1.15,
      };
    }
  }

  const price = fifteen.at(-1).c;
  const half = price * spreadPct / 200;
  return evaluateCryptoCandidateV34({
    asset: { symbol: 'BTC/USD', name: 'Bitcoin' },
    snapshot: { latestQuote: { bp: price - half, ap: price + half } },
    bars15m: fifteen,
    bars1h: hourly,
    bars1d: omitDaily ? [] : daily,
    intelligence,
  });
}

function rollingOverCandidate() {
  const daily = bars(50, 80, 0.28, 1440);
  const hourly = bars(1000, 70, 0.025, 60);
  const fifteen = bars(70, 98, 0.035, 15);
  const base = fifteen.at(-6).c;

  for (let offset = 5; offset >= 0; offset -= 1) {
    const index = fifteen.length - 1 - offset;
    const step = 6 - offset;
    fifteen[index] = {
      ...fifteen[index],
      o: base * (1 - (step - 1) * 0.0015),
      c: base * (1 - step * 0.0015),
      h: base * (1 - (step - 1) * 0.0010),
      l: base * (1 - step * 0.0020),
    };
  }

  const price = fifteen.at(-1).c;
  const half = price * 0.05 / 200;
  return evaluateCryptoCandidateV34({
    asset: { symbol: 'BTC/USD', name: 'Bitcoin' },
    snapshot: { latestQuote: { bp: price - half, ap: price + half } },
    bars15m: fifteen,
    bars1h: hourly,
    bars1d: daily,
  });
}

test('qualifies an aligned liquid multi-timeframe pullback', () => {
  const result = evaluate();
  assert.ok(result.signal, JSON.stringify(result.diagnostics));
  assert.equal(result.signal.strategy, 'CRYPTO_V34_EVIDENCE');
  assert.ok(result.signal.score >= 6.2);
  assert.ok(result.signal.signal.exitPlan.takeProfitPct > result.signal.signal.exitPlan.stopLossPct);
});

test('a bearish candidate is scored rather than falsely shown as 0/10', () => {
  const result = evaluate({ bearish: true });
  assert.equal(result.signal, null);
  assert.equal(result.diagnostics.hardReject, false);
  assert.equal(typeof result.diagnostics.score, 'number');
  assert.ok(result.diagnostics.score >= 0);
  assert.match(result.diagnostics.reason, /evidence score|costs/);
});

test('truly untradeable spread remains a hard reject and is not labeled 0/10', () => {
  const result = evaluate({ spreadPct: 0.40 });
  assert.equal(result.signal, null);
  assert.equal(result.diagnostics.hardReject, true);
  assert.equal(result.diagnostics.score, null);
  assert.match(result.diagnostics.reason, /spread/);
});

test('rolling immediate tape loses points without wiping the candidate to 0/10', () => {
  const result = rollingOverCandidate();
  assert.equal(result.signal, null);
  assert.equal(result.diagnostics.hardReject, false);
  assert.equal(typeof result.diagnostics.score, 'number');
  assert.ok(result.diagnostics.score > 0);
});

test('derives daily trend from hourly bars when daily history is sparse', () => {
  const result = evaluate({ omitDaily: true });
  assert.ok(result.signal, JSON.stringify(result.diagnostics));
  assert.equal(result.signal.signal.dailySource, 'derived_from_1Hour');
});

test('recognizes a confirmed sharp recovery before the long trend fully catches up', () => {
  const result = evaluate({ recovery: true });
  assert.ok(result.signal, JSON.stringify(result.diagnostics));
  assert.equal(result.signal.signal.trendRegime, 'CONFIRMED_RECOVERY');
  assert.ok(result.signal.signal.ret7dPct >= 4);
  assert.ok(result.signal.signal.ret28dPct < 0);
});

test('continuation can qualify without requiring an exact pullback/reclaim pattern', () => {
  const result = evaluate({ exactPullback: false });
  assert.ok(result.signal, JSON.stringify(result.diagnostics));
  assert.match(result.signal.signal.trigger, /CONTINUATION|BREAKOUT|POSITIVE_STRUCTURE/);
  assert.ok(result.signal.signal.ret1hPct > 0);
});

test('supporting intelligence can improve confidence but cannot force a bearish setup', () => {
  const bullish = evaluate({
    intelligence: { score: 8, reasons: ['broad risk-on confirmation'] },
  });
  assert.ok(bullish.signal, JSON.stringify(bullish.diagnostics));
  assert.ok(bullish.signal.signal.components.intelligence > 0);

  const bearish = evaluate({
    bearish: true,
    intelligence: { score: 10, reasons: ['strong external catalyst'] },
  });
  assert.equal(bearish.signal, null);
});

test('portfolio risk room, cash, symbol cap and exposure cap all constrain sizing', () => {
  const signal = evaluate().signal;
  assert.ok(signal);

  assert.ok(buildCryptoV34Budget({ equity: 100000, cash: 2000, signal }) <= 1900);
  assert.ok(buildCryptoV34Budget({ equity: 100000, cash: 50000, signal }) <= 15000);

  assert.equal(buildCryptoV34Budget({
    equity: 100000,
    cash: 50000,
    currentCryptoExposure: 60000,
    signal,
  }), 0);

  assert.equal(buildCryptoV34Budget({
    equity: 100000,
    cash: 50000,
    currentOpenRiskDollars: 2500,
    signal,
  }), 0);

  const roomy = buildCryptoV34Budget({
    equity: 100000,
    cash: 50000,
    currentOpenRiskDollars: 0,
    signal,
  });
  const tighter = buildCryptoV34Budget({
    equity: 100000,
    cash: 50000,
    currentOpenRiskDollars: 2300,
    signal,
  });
  assert.ok(tighter < roomy);
});
