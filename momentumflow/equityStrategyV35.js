// EQUITY STRATEGY V35 — structural expectancy gate over the frozen V34 scorer.
//
// V34 remains the baseline. V35 fixes a concrete regime-interpretation mismatch
// and adds hard alignment rules before a high score is allowed to become a trade.

import { evaluateEquityCandidateV34 } from './equityStrategyV34.js';

export const EQUITY_V35_DEFAULTS = {
  equityV35Enabled: true,
  equityV35ScoreThreshold: 8.5,
  equityV35BlockNeutralRegime: true,
  equityV35RequireRegimeAlignment: true,
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

  // V34's regime parser historically looked for words such as bull/bear,
  // risk-on/risk-off, up/down and strong/weak. buildEquityMarketRegime emits
  // LONG/SHORT/NEUTRAL. Add an explicit semantic label so the inherited V34
  // scorer receives the regime evidence it was designed to use.
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
  const threshold = num(config.equityV35ScoreThreshold, 8.5);

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
      reason: base?.reason || 'V35: V34 base scorer rejected candidate',
    };
  }

  const signal = base.signal;
  const direction = String(signal.direction || '').toUpperCase();
  const regimeDirection = String(rawRegime?.direction || '').toUpperCase();

  if (
    config.equityV35BlockNeutralRegime !== false &&
    !['LONG', 'SHORT'].includes(regimeDirection)
  ) {
    return {
      ...base,
      signal: null,
      reason: 'V35: neutral/uncertain market regime',
      score: signal.score,
    };
  }

  if (
    config.equityV35RequireRegimeAlignment !== false &&
    ['LONG', 'SHORT'].includes(regimeDirection) &&
    direction !== regimeDirection
  ) {
    return {
      ...base,
      signal: null,
      reason: `V35: ${direction} conflicts with ${regimeDirection} market regime`,
      score: signal.score,
    };
  }

  const bars = Array.isArray(args.bars) ? args.bars : [];
  const trend5 = returnPct(bars, 5);
  const trend15 = returnPct(bars, 15);
  const trend30 = returnPct(bars, 30);
  const sign = direction === 'SHORT' ? -1 : 1;
  const favored5 = trend5 * sign;
  const favored15 = trend15 * sign;
  const favored30 = trend30 * sign;

  if (
    favored15 < num(config.equityV35MinTrend15Pct, 0.02) ||
    favored30 < num(config.equityV35MinTrend30Pct, 0.02)
  ) {
    return {
      ...base,
      signal: null,
      reason: 'V35: 15m/30m trend not aligned strongly enough',
      score: signal.score,
      v35Trend: { trend5, trend15, trend30 },
    };
  }

  if (favored5 < -Math.abs(num(config.equityV35MaxCounterTrend5Pct, 0.05))) {
    return {
      ...base,
      signal: null,
      reason: 'V35: short-horizon momentum is fighting the trade',
      score: signal.score,
      v35Trend: { trend5, trend15, trend30 },
    };
  }

  return {
    ...base,
    signal: {
      ...signal,
      strategy: 'EQUITY_V35_EXPECTANCY',
      signal: {
        ...(signal.signal || {}),
        version: 'V35',
        evidence: [
          ...(signal.signal?.evidence || []),
          `V35 regime ${regimeDirection}`,
          `V35 trend ${trend5.toFixed(4)}/${trend15.toFixed(4)}/${trend30.toFixed(4)}%`,
        ],
      },
    },
    reason: null,
    v35Trend: { trend5, trend15, trend30 },
  };
}
