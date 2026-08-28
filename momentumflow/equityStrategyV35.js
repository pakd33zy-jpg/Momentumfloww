// EQUITY STRATEGY V35 — standalone evidence-weighted market model.
// No V33/V20/V34 strategy imports. Prior versions remain only as frozen baselines.

export const EQUITY_V35_DEFAULTS = {
  equityV35Enabled: true,
  equityV35ScoreThreshold: 5.8,
  equityV35EstimatedRoundTripCostPct: 0.04,
  equityV35PreferredSpreadPct: 0.08,
  equityV35MinBars: 12,
  equityV35MinStopPct: 0.30,
  equityV35MaxStopPct: 1.60,
  equityV35AtrStopMultiplier: 1.25,
  equityV35RewardRisk: 1.75,
  equityV35MaxHoldMinutes: 35,
  equityV35TrailTriggerR: 0.90,
  equityV35TrailDistanceR: 0.45,
  equityV35TrailFloorPct: 0.12,
};

const n = (v, fallback = NaN) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const c = (b) => n(b?.c ?? b?.close);
const o = (b) => n(b?.o ?? b?.open);
const h = (b) => n(b?.h ?? b?.high);
const l = (b) => n(b?.l ?? b?.low);
const v = (b) => n(b?.v ?? b?.volume, 0);

function avg(xs = []) {
  const good = xs.filter(Number.isFinite);
  return good.length ? good.reduce((a, b) => a + b, 0) / good.length : 0;
}

function cleanBars(bars = []) {
  return (bars || []).filter((bar) => c(bar) > 0);
}

function retPct(bars = [], lookback = 1) {
  const rows = cleanBars(bars);
  if (rows.length <= lookback) return 0;
  const last = c(rows.at(-1));
  const prior = c(rows.at(-(lookback + 1)));
  return prior > 0 ? (last / prior - 1) * 100 : 0;
}

function spreadPct(snapshot = {}) {
  const bid = n(snapshot?.latestQuote?.bp ?? snapshot?.bp);
  const ask = n(snapshot?.latestQuote?.ap ?? snapshot?.ap);
  if (!(bid > 0) || !(ask > 0) || ask < bid) return null;
  return (ask - bid) / ((ask + bid) / 2) * 100;
}

function atrPct(bars = [], length = 14) {
  const rows = cleanBars(bars);
  if (rows.length < 3) return 0;
  const start = Math.max(1, rows.length - length);
  const trs = [];
  for (let i = start; i < rows.length; i += 1) {
    const hi = h(rows[i]);
    const lo = l(rows[i]);
    const prev = c(rows[i - 1]);
    if (!(hi > 0) || !(lo > 0)) continue;
    trs.push(Math.max(hi - lo, Math.abs(hi - prev), Math.abs(lo - prev)));
  }
  const price = c(rows.at(-1));
  return price > 0 && trs.length ? avg(trs) / price * 100 : 0;
}

function volumeRatio(bars = [], lookback = 12) {
  const rows = cleanBars(bars);
  if (rows.length < 3) return 1;
  const current = v(rows.at(-1));
  const base = avg(rows.slice(Math.max(0, rows.length - 1 - lookback), -1).map(v).filter((x) => x > 0));
  return base > 0 && current > 0 ? current / base : 1;
}

function simpleVwap(bars = [], lookback = 30) {
  const rows = cleanBars(bars).slice(-lookback);
  let pv = 0;
  let vv = 0;
  for (const bar of rows) {
    const vol = v(bar);
    const hi = h(bar);
    const lo = l(bar);
    const close = c(bar);
    if (!(vol > 0) || ![hi, lo, close].every(Number.isFinite)) continue;
    pv += ((hi + lo + close) / 3) * vol;
    vv += vol;
  }
  return vv > 0 ? pv / vv : null;
}

function intelligenceBias(intelligence, direction) {
  if (!intelligence || typeof intelligence !== 'object') return 0;
  const sign = direction === 'SHORT' ? -1 : 1;
  const raw = n(
    intelligence?.netScore ??
    intelligence?.directionalScore ??
    intelligence?.score ??
    intelligence?.catalystScore,
    0,
  );
  return clamp(raw * sign * 0.12, -0.8, 0.8);
}

function marketRegimeDirection(regime = {}) {
  const d = String(regime?.direction || '').toUpperCase();
  return ['LONG', 'SHORT'].includes(d) ? d : 'NEUTRAL';
}

export function normalizeEquityRegimeV35(regime = {}) {
  return { ...regime, direction: marketRegimeDirection(regime) };
}

function scoreDirection({ direction, asset, snapshot, bars, marketRegime, intelligence, settings }) {
  const sign = direction === 'SHORT' ? -1 : 1;
  const rows = cleanBars(bars);
  const latest = rows.at(-1);
  const price = n(snapshot?.latestTrade?.p ?? snapshot?.minuteBar?.c ?? c(latest));
  if (!(price > 0)) return null;

  if (direction === 'SHORT' && !(asset?.shortable === true && (asset?.easy_to_borrow === true || asset?.easyToBorrow === true))) {
    return null;
  }

  const r1 = retPct(rows, 1);
  const r3 = retPct(rows, 3);
  const r5 = retPct(rows, 5);
  const r15 = retPct(rows, 15);
  const r30 = retPct(rows, 30);
  const vr = volumeRatio(rows);
  const spread = spreadPct(snapshot);
  const atr = atrPct(rows);
  const vw = simpleVwap(rows);
  const vwapDistance = vw > 0 ? (price / vw - 1) * 100 : 0;
  const bodyPct = o(latest) > 0 ? (c(latest) / o(latest) - 1) * 100 : 0;

  const changes = [];
  for (let i = Math.max(1, rows.length - 6); i < rows.length; i += 1) {
    const prior = c(rows[i - 1]);
    const cur = c(rows[i]);
    if (prior > 0 && cur > 0) changes.push((cur / prior - 1) * 100);
  }
  const alignedCloses = changes.filter((x) => x * sign > 0).length;

  const regimeDirection = marketRegimeDirection(marketRegime);
  const regimeAligned = regimeDirection === 'NEUTRAL' || regimeDirection === direction;

  let score = 2.0;
  score += alignedCloses >= 5 ? 1.25 : alignedCloses >= 4 ? 0.95 : alignedCloses >= 3 ? 0.55 : 0;
  score += r3 * sign >= 0.20 ? 1.2 : r3 * sign >= 0.10 ? 0.8 : r3 * sign > 0 ? 0.35 : -0.25;
  score += r15 * sign >= 0.40 ? 1.0 : r15 * sign >= 0.15 ? 0.65 : r15 * sign > 0 ? 0.25 : -0.30;
  score += r30 * sign >= 0.60 ? 0.75 : r30 * sign > 0 ? 0.30 : -0.20;
  score += r1 * sign > 0 ? 0.30 : -0.15;
  score += bodyPct * sign > 0 ? 0.25 : -0.10;
  score += vr >= 1.75 ? 0.85 : vr >= 1.2 ? 0.55 : vr >= 0.85 ? 0.20 : -0.25;
  score += vwapDistance * sign >= 0 && Math.abs(vwapDistance) <= 1.2 ? 0.55 : vwapDistance * sign < -0.75 ? -0.35 : 0;
  score += regimeAligned ? 0.35 : -0.35;
  score += intelligenceBias(intelligence, direction);

  if (spread != null) {
    const preferred = n(settings.equityV35PreferredSpreadPct, 0.08);
    if (spread <= preferred) score += 0.35;
    else if (spread <= preferred * 2) score += 0.10;
    else if (spread <= 0.50) score -= 0.30;
    else score -= clamp((spread - 0.50) * 0.8, 0.3, 1.5);
  }

  score = Number(clamp(score, 0, 10).toFixed(2));
  const stopLossPct = clamp(
    Math.max(n(settings.equityV35MinStopPct, 0.30), atr * n(settings.equityV35AtrStopMultiplier, 1.25)),
    n(settings.equityV35MinStopPct, 0.30),
    n(settings.equityV35MaxStopPct, 1.60),
  );
  const cost = Math.max(0, n(settings.equityV35EstimatedRoundTripCostPct, 0.04)) + Math.max(0, n(spread, 0) * 0.25);
  const takeProfitPct = Math.max(
    stopLossPct * n(settings.equityV35RewardRisk, 1.75) + cost,
    cost * 2.5,
  );

  return {
    direction,
    score,
    price,
    metrics: { r1, r3, r5, r15, r30, vr, spread, atr, vwapDistance, bodyPct, alignedCloses, regimeDirection, regimeAligned },
    exitPlan: {
      stopLossPct: Number(stopLossPct.toFixed(4)),
      takeProfitPct: Number(takeProfitPct.toFixed(4)),
      estimatedRoundTripCostPct: Number(cost.toFixed(4)),
      trailTriggerPct: Number((stopLossPct * n(settings.equityV35TrailTriggerR, 0.90)).toFixed(4)),
      trailDistancePct: Number((stopLossPct * n(settings.equityV35TrailDistanceR, 0.45)).toFixed(4)),
      trailFloorPct: Number(Math.max(n(settings.equityV35TrailFloorPct, 0.12), cost + 0.03).toFixed(4)),
      maxHoldMinutes: Math.max(5, n(settings.equityV35MaxHoldMinutes, 35)),
    },
  };
}

export function evaluateEquityCandidateV35(args = {}) {
  const settings = { ...EQUITY_V35_DEFAULTS, ...(args.config || {}) };
  const asset = args.asset || {};
  const symbol = String(asset?.symbol || '').toUpperCase();
  const rows = cleanBars(args.bars || []);

  if (!symbol) return { signal: null, reason: 'V35: missing symbol', diagnostics: { hardReject: true, reason: 'missing symbol' } };
  if (asset?.tradable === false) return { signal: null, reason: 'V35: asset not tradable', diagnostics: { hardReject: true, reason: 'asset not tradable' } };
  if (rows.length < n(settings.equityV35MinBars, 12)) {
    return { signal: null, reason: `V35: insufficient market history (${rows.length})`, diagnostics: { hardReject: true, reason: 'insufficient history', bars: rows.length } };
  }

  const long = scoreDirection({ direction: 'LONG', asset, snapshot: args.snapshot, bars: rows, marketRegime: args.marketRegime, intelligence: args.intelligence, settings });
  const short = scoreDirection({ direction: 'SHORT', asset, snapshot: args.snapshot, bars: rows, marketRegime: args.marketRegime, intelligence: args.intelligence, settings });
  const choices = [long, short].filter(Boolean).sort((a, b) => b.score - a.score);
  const best = choices[0];
  const threshold = n(settings.equityV35ScoreThreshold, 5.8);

  if (!best || best.score < threshold) {
    return {
      signal: null,
      reason: 'V35: evidence below threshold',
      score: best?.score ?? null,
      diagnostics: { hardReject: false, reason: 'evidence below threshold', threshold, long, short },
    };
  }

  const evidence = [
    `${best.direction} tape 1/3/15/30m ${best.metrics.r1.toFixed(3)}/${best.metrics.r3.toFixed(3)}/${best.metrics.r15.toFixed(3)}/${best.metrics.r30.toFixed(3)}%`,
    `aligned closes ${best.metrics.alignedCloses}/5 rel volume x${best.metrics.vr.toFixed(2)}`,
    `regime ${best.metrics.regimeDirection} ${best.metrics.regimeAligned ? 'supporting' : 'counter'}`,
    `VWAP distance ${best.metrics.vwapDistance.toFixed(3)}% spread ${Number.isFinite(best.metrics.spread) ? best.metrics.spread.toFixed(3) : 'n/a'}%`,
  ];

  return {
    signal: {
      symbol,
      name: asset?.name || symbol,
      assetClass: 'us_equity',
      direction: best.direction,
      score: best.score,
      price: best.price,
      strategy: 'EQUITY_V35_STANDALONE',
      signal: {
        version: 'V35',
        playbook: 'MARKET_EVIDENCE',
        score: best.score,
        threshold,
        evidence,
        metrics: best.metrics,
        exitPlan: best.exitPlan,
      },
    },
    diagnostics: { eligible: true, hardReject: false, reason: null, score: best.score, threshold, long, short },
    reason: null,
  };
}
