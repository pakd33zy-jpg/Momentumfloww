// EQUITY STRATEGY V35 — evidence-weighted expectancy layer over frozen V34.
// Adds a direct tape/candle lane so obvious price action can qualify without
// first surviving every legacy V34 soft gate.

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

  equityV35TapeEnabled: true,
  equityV35TapeScoreThreshold: 5.5,
  equityV35TapeMaxSpreadPct: 0.50,
  equityV35TapeMinBars: 8,
  equityV35TapeStopPct: 0.45,
  equityV35TapeRewardRisk: 1.70,
  equityV35TapeMaxHoldMinutes: 20,
};

const num = (value, fallback = NaN) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const closeOf = (bar) => num(bar?.c ?? bar?.close);
const openOf = (bar) => num(bar?.o ?? bar?.open);
const highOf = (bar) => num(bar?.h ?? bar?.high);
const lowOf = (bar) => num(bar?.l ?? bar?.low);
const volumeOf = (bar) => num(bar?.v ?? bar?.volume, 0);

function avg(values = []) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : 0;
}

function returnPct(bars = [], lookback = 1) {
  if (!Array.isArray(bars) || bars.length < 2) return 0;
  const last = closeOf(bars.at(-1));
  const prior = closeOf(bars[Math.max(0, bars.length - 1 - Math.max(1, lookback))]);
  if (!(last > 0) || !(prior > 0)) return 0;
  return ((last / prior) - 1) * 100;
}

function spreadPct(snapshot = {}) {
  const bid = num(snapshot?.latestQuote?.bp ?? snapshot?.bp);
  const ask = num(snapshot?.latestQuote?.ap ?? snapshot?.ap);
  if (!(bid > 0) || !(ask > 0) || ask < bid) return null;
  const mid = (bid + ask) / 2;
  return mid > 0 ? ((ask - bid) / mid) * 100 : null;
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

function evaluateTapeLane(args, config) {
  if (config.equityV35TapeEnabled === false) return null;

  const bars = (Array.isArray(args.bars) ? args.bars : [])
    .filter((bar) => closeOf(bar) > 0)
    .slice(-12);
  if (bars.length < Math.max(6, num(config.equityV35TapeMinBars, 8))) return null;

  const asset = args.asset || {};
  const symbol = String(asset?.symbol || '').toUpperCase();
  const latest = bars.at(-1);
  const price = num(args.snapshot?.latestTrade?.p ?? latest?.c);
  if (!(price > 0)) return null;

  const spread = spreadPct(args.snapshot);
  if (spread != null && spread > num(config.equityV35TapeMaxSpreadPct, 0.50)) return null;

  const ret1 = returnPct(bars, 1);
  const ret3 = returnPct(bars, 3);
  const ret5 = returnPct(bars, 5);
  const direction = ret3 >= 0 ? 'LONG' : 'SHORT';
  const sign = direction === 'SHORT' ? -1 : 1;

  if (
    direction === 'SHORT' &&
    !(asset?.shortable === true && (asset?.easy_to_borrow === true || asset?.easyToBorrow === true))
  ) return null;

  const changes = [];
  for (let i = Math.max(1, bars.length - 5); i < bars.length; i += 1) {
    const prior = closeOf(bars[i - 1]);
    const current = closeOf(bars[i]);
    if (prior > 0 && current > 0) changes.push(((current / prior) - 1) * 100);
  }

  const alignedCloses = changes.filter((x) => x * sign > 0).length;
  const bodyPct = ((closeOf(latest) - openOf(latest)) / Math.max(openOf(latest), 0.0000001)) * 100;
  const priorRanges = bars.slice(-6, -1).map((bar) => {
    const c = closeOf(bar);
    return c > 0 ? ((highOf(bar) - lowOf(bar)) / c) * 100 : 0;
  });
  const latestRangePct = ((highOf(latest) - lowOf(latest)) / price) * 100;
  const rangeRatio = avg(priorRanges) > 0 ? latestRangePct / avg(priorRanges) : 1;
  const priorVolumes = bars.slice(-6, -1).map(volumeOf);
  const volumeRatio = avg(priorVolumes) > 0 ? volumeOf(latest) / avg(priorVolumes) : 1;

  const regimeDirection = String(args.marketRegime?.direction || '').toUpperCase();
  const regimeAligned = !['LONG', 'SHORT'].includes(regimeDirection) || regimeDirection === direction;

  let score = 2.4;
  score += alignedCloses >= 4 ? 1.5 : alignedCloses >= 3 ? 1.0 : alignedCloses >= 2 ? 0.4 : 0;
  score += ret3 * sign >= 0.20 ? 1.5 : ret3 * sign >= 0.10 ? 1.0 : ret3 * sign >= 0.04 ? 0.5 : 0;
  score += ret5 * sign >= 0.30 ? 1.0 : ret5 * sign >= 0.15 ? 0.6 : ret5 * sign > 0 ? 0.2 : 0;
  if (ret1 * sign > 0) score += 0.35;
  if (bodyPct * sign > 0) score += 0.35;
  if (rangeRatio >= 1.5) score += 0.65;
  else if (rangeRatio >= 1.15) score += 0.30;
  if (volumeRatio >= 1.75) score += 0.65;
  else if (volumeRatio >= 1.15) score += 0.30;
  score += regimeAligned ? 0.20 : -0.20;
  score = Number(clamp(score, 0, 10).toFixed(2));

  const threshold = num(config.equityV35TapeScoreThreshold, 5.5);
  if (score < threshold) return null;

  const stopLossPct = clamp(
    Math.max(num(config.equityV35TapeStopPct, 0.45), latestRangePct * 1.25),
    0.30,
    1.50,
  );
  const estimatedRoundTripCostPct = 0.04;
  const takeProfitPct = stopLossPct * num(config.equityV35TapeRewardRisk, 1.70) + estimatedRoundTripCostPct;

  const detail = {
    version: 'V35',
    playbook: 'TAPE_CANDLE_MOMENTUM',
    score,
    threshold,
    ret1Pct: ret1,
    ret3Pct: ret3,
    ret5Pct: ret5,
    alignedCloses,
    bodyPct,
    rangeRatio,
    volumeRatio,
    spreadPct: spread,
    regimeDirection,
    regimeAligned,
    evidence: [
      `tape ${direction} ${alignedCloses}/${changes.length} aligned closes`,
      `move 1/3/5m ${ret1.toFixed(3)}/${ret3.toFixed(3)}/${ret5.toFixed(3)}%`,
      `range x${rangeRatio.toFixed(2)} volume x${volumeRatio.toFixed(2)}`,
    ],
    exitPlan: {
      stopLossPct,
      takeProfitPct,
      trailTriggerPct: stopLossPct * 0.9,
      trailDistancePct: stopLossPct * 0.45,
      trailFloorPct: Math.max(0.12, estimatedRoundTripCostPct + 0.05),
      maxHoldMinutes: Math.max(5, num(config.equityV35TapeMaxHoldMinutes, 20)),
      estimatedRoundTripCostPct,
    },
  };

  return {
    signal: {
      symbol,
      name: asset?.name || symbol,
      assetClass: 'us_equity',
      direction,
      score,
      price,
      strategy: 'EQUITY_V35_TAPE',
      signal: detail,
    },
    diagnostics: {
      eligible: true,
      hardReject: false,
      reason: null,
      score,
      threshold,
      metrics: detail,
    },
    reason: null,
    tapeLane: true,
  };
}

export function evaluateEquityCandidateV35(args = {}) {
  const config = { ...EQUITY_V35_DEFAULTS, ...(args.config || {}) };
  const rawRegime = args.marketRegime || {};

  // First evaluate direct candle/tape behavior. This is intentionally independent
  // of legacy V34 soft filters.
  const tape = evaluateTapeLane(args, config);
  if (tape?.signal) return tape;

  const marketRegime = normalizeEquityRegimeV35(rawRegime);
  const threshold = num(config.equityV35ScoreThreshold, 6.5);
  const base = evaluateEquityCandidateV34({
    ...args,
    marketRegime,
    config: { ...(args.config || {}), equityV34ScoreThreshold: threshold },
  });

  if (!base?.signal) {
    return { ...base, reason: base?.reason || 'V35: base scorer rejected candidate' };
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
  const trendAligned = favored15 >= num(config.equityV35MinTrend15Pct, 0.02) &&
    favored30 >= num(config.equityV35MinTrend30Pct, 0.02) &&
    favored5 >= -Math.abs(num(config.equityV35MaxCounterTrend5Pct, 0.05));

  if (config.equityV35BlockNeutralRegime === true && !['LONG', 'SHORT'].includes(regimeDirection)) {
    return { ...base, signal: null, reason: 'V35: neutral/uncertain market regime', score: signal.score };
  }
  if (config.equityV35RequireRegimeAlignment === true && !regimeAligned) {
    return { ...base, signal: null, reason: `V35: ${direction} conflicts with ${regimeDirection} market regime`, score: signal.score };
  }
  if (config.equityV35RequireTrendAlignment === true && !trendAligned) {
    return { ...base, signal: null, reason: 'V35: multi-horizon trend alignment requirement failed', score: signal.score };
  }

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
        evidence: [
          ...(signal.signal?.evidence || []),
          `V35 regime ${regimeDirection || 'UNKNOWN'} ${regimeAligned ? 'aligned' : 'counter'}`,
          `V35 trend ${trend5.toFixed(4)}/${trend15.toFixed(4)}/${trend30.toFixed(4)}% ${trendAligned ? 'aligned' : 'mixed'}`,
        ],
      },
    },
    reason: null,
    v35Trend: { trend5, trend15, trend30 },
  };
}
