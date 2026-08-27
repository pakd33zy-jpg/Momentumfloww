// EQUITY STRATEGY V35 — evidence-weighted expectancy layer over the frozen V34 scorer.
//
// V34 remains the baseline. V35 fixes the regime interpretation mismatch and
// treats regime/trend as evidence by default instead of automatic kill switches.

import { evaluateEquityCandidateV34 } from './equityStrategyV34.js';

export const EQUITY_V35_DEFAULTS = {
  equityV35Enabled: true,
  equityV35ScoreThreshold: 6.5,
  equityV35BlockNeutralRegime: false,
  equityV35RequireRegimeAlignment: false,
  equityV35RequireTrendAlignment: false,
  equityV35MinTrend15Pct: 0.02,
  equityV35MinTrend30Pct: 0.02,
  equityV35MaxCounterTrend5Pct: 0.05,
};

const num = (value, fallback = NaN) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

function closeOf(bar) {
  return num(bar?.c ?? bar?.close);
}

function returnPct(bars = [], lookback = 1) {
  if (!Array.isArray(bars) || bars.length < 2) return 0;
  const last = closeOf(bars[bars.length - 1]);
  const index = Math.max(0, bars.length - 1 - Math.max(1, lookback));
  const prior = closeOf(bars[index]);
  if (!(last > 0) || !(prior > 0)) return 0;
  return ((last / prior) - 1) * 100;
}

export function normalizeEquityRegimeV35(regime = {}) {
  const direction = String(regime?.direction || '').toUpperCase();
  const semanticBias = direction === 'LONG'
    ? 'bull risk-on up strong'
    : direction === 'SHORT'
      ? 'bear risk-off down weak'
      : 'neutral mixed';
  return { ...regime, direction, semanticBias };
}

export function evaluateEquityCandidateV35(args = {}) {
  const config = {
    ...EQUITY_V35_DEFAULTS,
    ...(args.config || {}),
  };

  const rawRegime = args.marketRegime || {};
  const marketRegime = normalizeEquityRegimeV35(rawRegime);
  const threshold = num(config.equityV35ScoreThreshold, 6.5);

  const base = evaluateEquityCandidateV34({
    ...args,
    marketRegime,
    config: {
      ...(args.config || {}),
      equityV34ScoreThreshold: threshold,
    },
  });

  if (!base?.signal) {
    return {
      ...base,
      reason: base?.reason || 'V35: base scorer rejected candidate',
    };
  }

  const signal = base.signal;
  const direction = String(signal.direction || '').toUpperCase();
  const regimeDirection = String(rawRegime?.direction || '').toUpperCase();
  const bars = Array.isArray(args.bars) ? args.bars : [];
  const trend5 = returnPct(bars, 5);
  const trend15 = returnPct(bars, 15);
  const trend30 = returnPct(bars, 30);
  const sign = direction === 'SHORT' ? -1 : 1;
  const favored5 = trend5 * sign;
  const favored15 = trend15 * sign;
  const favored30 = trend30 * sign;
  const regimeAligned = !['LONG', 'SHORT'].includes(regimeDirection) || direction === regimeDirection;
  const trendAligned =
    favored15 >= num(config.equityV35MinTrend15Pct, 0.02) &&
    favored30 >= num(config.equityV35MinTrend30Pct, 0.02) &&
    favored5 >= -Math.abs(num(config.equityV35MaxCounterTrend5Pct, 0.05));

  if (
    config.equityV35BlockNeutralRegime === true &&
    !['LONG', 'SHORT'].includes(regimeDirection)
  ) {
    return { ...base, signal: null, reason: 'V35: neutral/uncertain market regime', score: signal.score };
  }

  if (
    config.equityV35RequireRegimeAlignment === true &&
    ['LONG', 'SHORT'].includes(regimeDirection) &&
    !regimeAligned
  ) {
    return { ...base, signal: null, reason: `V35: ${direction} conflicts with ${regimeDirection} market regime`, score: signal.score };
  }

  if (config.equityV35RequireTrendAlignment === true && !trendAligned) {
    return {
      ...base,
      signal: null,
      reason: 'V35: multi-horizon trend alignment requirement failed',
      score: signal.score,
      v35Trend: { trend5, trend15, trend30 },
    };
  }

  const evidence = [
    ...(signal.signal?.evidence || []),
    `V35 regime ${regimeDirection || 'UNKNOWN'} ${regimeAligned ? 'aligned' : 'counter'}`,
    `V35 trend ${trend5.toFixed(4)}/${trend15.toFixed(4)}/${trend30.toFixed(4)}% ${trendAligned ? 'aligned' : 'mixed'}`,
  ];

  return {
    ...base,
    signal: {
      ...signal,
      strategy: 'EQUITY_V35_EXPECTANCY',
      signal: {
        ...(signal.signal || {}),
        version: 'V35',
        regimeAligned,
        trendAligned,
        v35Trend: { trend5, trend15, trend30 },
        evidence,
      },
    },
    reason: null,
    v35Trend: { trend5, trend15, trend30 },
  };
}
