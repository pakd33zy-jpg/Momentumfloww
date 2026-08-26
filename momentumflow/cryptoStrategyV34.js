// CRYPTO STRATEGY V34 — evidence-weighted, fee-aware, multi-timeframe strategy.
//
// V34 removes most binary technical gates. Candidates with valid market data are
// scored across trend, momentum, trigger quality, volume, execution quality and
// optional market-intelligence context. Only truly invalid/untradeable conditions
// hard-reject before scoring.
//
// Crypto remains LONG/cash because Alpaca crypto is spot. No strategy guarantees
// profit; validate with replay/backtests and PAPER fills before LIVE.

export const CRYPTO_V34_DEFAULTS = {
  cryptoV34Enabled: true,
  cryptoV34Symbols: [
    'BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD',
    'AVAX/USD', 'LTC/USD', 'BCH/USD', 'DOGE/USD',
  ],

  // Execution: soft quality threshold plus a true hard ceiling.
  cryptoV34PreferredSpreadPct: 0.10,
  cryptoV34MaxSpreadPct: 0.30,
  cryptoV34EstimatedRoundTripCostPct: 0.50,
  cryptoV34MinNetEdgePct: 0.20,
  cryptoV34MinScore: 6.2,

  // Multi-timeframe structure.
  cryptoV34DailyFastEma: 7,
  cryptoV34DailySlowEma: 28,
  cryptoV34HourlyFastEma: 12,
  cryptoV34HourlySlowEma: 36,
  cryptoV34PullbackEma: 20,
  cryptoV34Recovery7dPct: 4.0,
  cryptoV34Recovery24hPct: 0.50,

  // Exit/risk model.
  cryptoV34AtrStopMultiple: 1.8,
  cryptoV34MinStopPct: 1.25,
  cryptoV34MaxStopPct: 4.5,
  cryptoV34RewardRisk: 2.0,
  cryptoV34MaxHoldMinutes: 3 * 24 * 60,
  cryptoV34TrailTriggerR: 1.0,
  cryptoV34TrailDistanceR: 0.65,

  // Per-position risk is configurable; portfolio risk is the primary limiter.
  cryptoV34RiskFraction: 0.005,
  cryptoV34MaxPortfolioRiskFraction: 0.025,
  cryptoV34MaxPositionFraction: 0.15,
  cryptoV34MaxTotalExposureFraction: 0.60,
  cryptoV34MaxConcurrentPositions: 6,

  // Optional external intelligence is supporting evidence, never an auto-buy.
  // Expected input is a 0..10 score built from catalyst/macro/flow research.
  cryptoV34IntelligenceWeight: 0.10,
};

const number = (value, fallback = NaN) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const close = (bar) => number(bar?.c ?? bar?.close);
const high = (bar) => number(bar?.h ?? bar?.high);
const low = (bar) => number(bar?.l ?? bar?.low);
const volume = (bar) => number(bar?.v ?? bar?.volume, 0);

function validBars(bars) {
  return (bars || []).filter((bar) =>
    Number.isFinite(close(bar)) && close(bar) > 0
  );
}

function aggregateHourlyToDaily(bars) {
  const groups = new Map();
  for (const bar of validBars(bars)) {
    const timestamp = new Date(bar?.t ?? bar?.timestamp ?? 0);
    if (!Number.isFinite(timestamp.getTime())) continue;
    const key = timestamp.toISOString().slice(0, 10);
    const row = groups.get(key);
    if (!row) {
      groups.set(key, {
        t: `${key}T00:00:00.000Z`,
        o: number(bar?.o ?? bar?.open, close(bar)),
        h: high(bar),
        l: low(bar),
        c: close(bar),
        v: volume(bar),
      });
    } else {
      row.h = Math.max(row.h, high(bar));
      row.l = Math.min(row.l, low(bar));
      row.c = close(bar);
      row.v += volume(bar);
    }
  }
  return [...groups.values()];
}

export function ema(values, length) {
  const clean = (values || []).filter(Number.isFinite);
  if (clean.length < length || length < 2) return null;
  const alpha = 2 / (length + 1);
  let result = clean.slice(0, length).reduce((a, b) => a + b, 0) / length;
  for (const value of clean.slice(length)) result = value * alpha + result * (1 - alpha);
  return result;
}

export function atrPct(bars, length = 14) {
  const clean = validBars(bars);
  if (clean.length < length + 1) return null;
  const ranges = [];
  for (let index = clean.length - length; index < clean.length; index += 1) {
    const prior = close(clean[index - 1]);
    ranges.push(Math.max(
      high(clean[index]) - low(clean[index]),
      Math.abs(high(clean[index]) - prior),
      Math.abs(low(clean[index]) - prior),
    ));
  }
  const current = close(clean.at(-1));
  return ranges.reduce((a, b) => a + b, 0) / ranges.length / current * 100;
}

function returnPct(bars, lookback) {
  const clean = validBars(bars);
  if (clean.length <= lookback) return null;
  const start = close(clean.at(-(lookback + 1)));
  return (close(clean.at(-1)) / start - 1) * 100;
}

function volumeRatio(bars, lookback = 20) {
  const clean = validBars(bars);
  if (clean.length < lookback + 1) return null;
  const baseline = clean.slice(-(lookback + 1), -1).map(volume);
  const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  return mean > 0 ? volume(clean.at(-1)) / mean : null;
}

function hardReject(reason, metrics = {}) {
  return {
    signal: null,
    diagnostics: {
      eligible: false,
      hardReject: true,
      reason,
      score: null,
      threshold: null,
      metrics,
    },
  };
}

function scoredReject(reason, score, threshold, metrics = {}) {
  return {
    signal: null,
    diagnostics: {
      eligible: false,
      hardReject: false,
      reason,
      score,
      threshold,
      metrics: { ...metrics, score },
      long: { eligible: false, score, reason, ...metrics },
    },
  };
}

function scoreTrend({ price, dFast, dSlow, hFast, priorHFast, hSlow, ret7d, ret28d, ret24h, c }) {
  const establishedDailyTrend =
    price > dSlow && dFast > dSlow && ret7d > 0 && ret28d > 0;
  const recoveryDailyTrend =
    price > dFast && ret7d >= c.cryptoV34Recovery7dPct && ret24h >= c.cryptoV34Recovery24hPct;
  const hourlyTrend = hFast > hSlow && hFast > priorHFast && ret24h > 0;

  let daily = 0;
  if (establishedDailyTrend) daily = 2.0;
  else if (recoveryDailyTrend) daily = 1.7;
  else if (price > dFast && ret7d > 0) daily = 1.0;
  else if (ret7d > 0 || ret24h > 0) daily = 0.5;
  else daily = -0.6;

  let hourly = 0;
  if (hourlyTrend) hourly = 2.0;
  else if (hFast > hSlow && ret24h > 0) hourly = 1.3;
  else if (hFast > priorHFast || ret24h > 0) hourly = 0.6;
  else if (ret24h < -1) hourly = -0.8;

  return { daily, hourly, establishedDailyTrend, recoveryDailyTrend, hourlyTrend };
}

export function evaluateCryptoCandidateV34({
  asset,
  snapshot,
  bars15m,
  bars1h,
  bars1d,
  intelligence = null,
  config = {},
}) {
  const c = { ...CRYPTO_V34_DEFAULTS, ...config };
  const symbol = String(asset?.symbol || '');
  if (!c.cryptoV34Symbols.includes(symbol)) {
    return hardReject('V34: outside configured liquid crypto universe');
  }

  const b15 = validBars(bars15m);
  const b1h = validBars(bars1h);
  let b1d = validBars(bars1d);
  let dailySource = '1Day';
  if (b1d.length < 28) {
    const derivedDaily = aggregateHourlyToDaily(b1h);
    if (derivedDaily.length > b1d.length) {
      b1d = derivedDaily;
      dailySource = 'derived_from_1Hour';
    }
  }

  // Missing history is not a 0/10 setup; it is an unscorable data-quality condition.
  if (b15.length < 32 || b1h.length < 40 || b1d.length < 28) {
    return hardReject(
      `V34: insufficient history (15m=${b15.length}, 1h=${b1h.length}, 1d=${b1d.length}, source=${dailySource})`,
      { bars15m: b15.length, bars1h: b1h.length, bars1d: b1d.length, dailySource },
    );
  }

  const bid = number(snapshot?.latestQuote?.bp ?? snapshot?.bp);
  const ask = number(snapshot?.latestQuote?.ap ?? snapshot?.ap);
  const price = ask > 0 ? ask : close(b15.at(-1));
  const spread = bid > 0 && ask > 0 ? (ask - bid) / ((ask + bid) / 2) * 100 : null;
  if (spread == null || spread > c.cryptoV34MaxSpreadPct) {
    return hardReject('V34: spread is untradeable', { spreadPct: spread });
  }

  const dailyCloses = b1d.map(close);
  const hourlyCloses = b1h.map(close);
  const closes15 = b15.map(close);
  const dFast = ema(dailyCloses, c.cryptoV34DailyFastEma);
  const dSlow = ema(dailyCloses, c.cryptoV34DailySlowEma);
  const hFast = ema(hourlyCloses, c.cryptoV34HourlyFastEma);
  const priorHFast = ema(hourlyCloses.slice(0, -1), c.cryptoV34HourlyFastEma);
  const hSlow = ema(hourlyCloses, c.cryptoV34HourlySlowEma);
  const pullbackEma = ema(closes15, c.cryptoV34PullbackEma);
  const priorPullbackEma = ema(closes15.slice(0, -1), c.cryptoV34PullbackEma);
  const ret7d = returnPct(b1d, 7);
  const ret28d = returnPct(b1d, 27);
  const ret6h = returnPct(b1h, 6);
  const ret24h = returnPct(b1h, 24);
  const ret1h = returnPct(b15, 4);
  const volRatio = volumeRatio(b15);

  const trend = scoreTrend({
    price, dFast, dSlow, hFast, priorHFast, hSlow,
    ret7d, ret28d, ret24h, c,
  });

  const latest = close(b15.at(-1));
  const previous = close(b15.at(-2));
  const recentHigh = Math.max(...b15.slice(-9, -1).map(high));
  const recentLow = Math.min(...b15.slice(-9, -1).map(low));
  const tapeRising = latest > previous && pullbackEma >= priorPullbackEma && ret1h > 0;
  const reclaim = previous <= priorPullbackEma && latest > pullbackEma && tapeRising;
  const shallowPullback =
    recentLow <= pullbackEma * 1.006 && latest > pullbackEma && ret6h > -0.75 && tapeRising;
  const breakout = latest > recentHigh && ret6h > 0 && latest > previous;
  const continuation =
    latest > pullbackEma && pullbackEma >= priorPullbackEma && ret1h > 0.10 && ret6h > 0;

  let triggerScore = 0;
  let trigger = 'NO_CLEAN_TRIGGER';
  if (reclaim) { triggerScore = 2.0; trigger = '15M_RECLAIM'; }
  else if (shallowPullback) { triggerScore = 1.8; trigger = '15M_PULLBACK'; }
  else if (breakout) { triggerScore = 1.7; trigger = '15M_BREAKOUT'; }
  else if (continuation) { triggerScore = 1.25; trigger = '15M_CONTINUATION'; }
  else if (latest > pullbackEma && ret1h > 0) { triggerScore = 0.6; trigger = '15M_POSITIVE_STRUCTURE'; }
  else if (ret1h < -0.5) triggerScore = -0.8;

  const volatility = atrPct(b1h);
  if (volatility == null) return hardReject('V34: hourly ATR unavailable');

  const stopLossPct = Math.min(
    c.cryptoV34MaxStopPct,
    Math.max(c.cryptoV34MinStopPct, volatility * c.cryptoV34AtrStopMultiple),
  );
  const takeProfitPct = stopLossPct * c.cryptoV34RewardRisk + c.cryptoV34EstimatedRoundTripCostPct;
  const expectedMovePct = Math.max(Math.abs(ret24h || 0) * 0.45, volatility * 1.5);
  const requiredMovePct = c.cryptoV34EstimatedRoundTripCostPct + c.cryptoV34MinNetEdgePct;

  let momentumScore = 0;
  if (ret24h > 2) momentumScore = 1.2;
  else if (ret24h > 1) momentumScore = 1.0;
  else if (ret24h > 0.25) momentumScore = 0.7;
  else if (ret24h > 0) momentumScore = 0.35;
  else if (ret24h < -2) momentumScore = -1.0;
  else if (ret24h < 0) momentumScore = -0.4;

  let volumeScore = 0.15;
  if (volRatio != null && volRatio >= 2) volumeScore = 0.8;
  else if (volRatio != null && volRatio >= 1.25) volumeScore = 0.6;
  else if (volRatio != null && volRatio >= 1.05) volumeScore = 0.4;
  else if (volRatio != null && volRatio < 0.65) volumeScore = -0.2;

  let spreadScore = 0;
  if (spread <= c.cryptoV34PreferredSpreadPct) spreadScore = 0.7;
  else if (spread <= c.cryptoV34PreferredSpreadPct * 1.5) spreadScore = 0.45;
  else if (spread <= c.cryptoV34PreferredSpreadPct * 2.2) spreadScore = 0.15;
  else spreadScore = -0.35;

  let feeEdgeScore = 0;
  if (expectedMovePct >= requiredMovePct * 2) feeEdgeScore = 1.0;
  else if (expectedMovePct >= requiredMovePct * 1.5) feeEdgeScore = 0.8;
  else if (expectedMovePct >= requiredMovePct) feeEdgeScore = 0.45;
  else feeEdgeScore = -1.0;

  const intelligenceRaw = Number.isFinite(Number(intelligence?.netScore))
    ? clamp(Number(intelligence.netScore), -10, 10)
    : clamp(number(intelligence?.score, 0), 0, 10);
  const intelligenceScore = intelligenceRaw * c.cryptoV34IntelligenceWeight;

  const rawScore =
    trend.daily + trend.hourly + triggerScore + momentumScore +
    volumeScore + spreadScore + feeEdgeScore + intelligenceScore;
  const score = Number(clamp(rawScore, 0, 10).toFixed(2));

  const components = {
    dailyTrend: Number(trend.daily.toFixed(2)),
    hourlyTrend: Number(trend.hourly.toFixed(2)),
    trigger: Number(triggerScore.toFixed(2)),
    momentum: Number(momentumScore.toFixed(2)),
    volume: Number(volumeScore.toFixed(2)),
    spread: Number(spreadScore.toFixed(2)),
    feeEdge: Number(feeEdgeScore.toFixed(2)),
    intelligence: Number(intelligenceScore.toFixed(2)),
  };

  const trendRegime = trend.establishedDailyTrend
    ? 'ESTABLISHED_TREND'
    : trend.recoveryDailyTrend
      ? 'CONFIRMED_RECOVERY'
      : trend.hourlyTrend
        ? 'EARLY_OR_MIXED_TREND'
        : 'MIXED_OR_WEAK';

  const metrics = {
    score,
    components,
    trigger,
    spreadPct: spread,
    ret7dPct: ret7d,
    ret28dPct: ret28d,
    ret24hPct: ret24h,
    ret6hPct: ret6h,
    ret1hPct: ret1h,
    volumeRatio: volRatio,
    trendRegime,
    establishedDailyTrend: trend.establishedDailyTrend,
    recoveryDailyTrend: trend.recoveryDailyTrend,
    hourlyTrend: trend.hourlyTrend,
    tapeRising,
    hourlyAtrPct: volatility,
    expectedMovePct,
    requiredMovePct,
    intelligenceScore: intelligenceRaw,
    intelligenceReasons: Array.isArray(intelligence?.reasons) ? intelligence.reasons.slice(0, 8) : [],
    dailySource,
  };

  // Cost/edge is a real economic constraint, but preserve the actual setup score.
  if (expectedMovePct < requiredMovePct) {
    return scoredReject('V34: expected move does not clear estimated costs and edge buffer', score, c.cryptoV34MinScore, metrics);
  }

  if (score < c.cryptoV34MinScore) {
    return scoredReject('V34: evidence score below threshold', score, c.cryptoV34MinScore, metrics);
  }

  const detail = {
    eligible: true,
    reason: null,
    ...metrics,
    exitPlan: {
      stopLossPct,
      takeProfitPct,
      trailTriggerPct: stopLossPct * c.cryptoV34TrailTriggerR,
      trailDistancePct: stopLossPct * c.cryptoV34TrailDistanceR,
      trailFloorPct: Math.max(c.cryptoV34EstimatedRoundTripCostPct + 0.10, stopLossPct * 0.35),
      maxHoldMinutes: c.cryptoV34MaxHoldMinutes,
      estimatedRoundTripCostPct: c.cryptoV34EstimatedRoundTripCostPct,
    },
  };

  return {
    signal: {
      symbol,
      name: asset?.name || symbol,
      assetClass: 'crypto',
      fractionable: true,
      direction: 'LONG',
      score,
      price,
      strategy: 'CRYPTO_V34_EVIDENCE',
      signal: detail,
    },
    diagnostics: {
      eligible: true,
      hardReject: false,
      reason: null,
      score,
      threshold: c.cryptoV34MinScore,
      metrics: detail,
    },
  };
}

export function buildCryptoV34Budget({
  equity,
  cash,
  currentCryptoExposure = 0,
  currentOpenRiskDollars = 0,
  signal,
  config = {},
}) {
  const c = { ...CRYPTO_V34_DEFAULTS, ...config };
  const stopPct = number(signal?.signal?.exitPlan?.stopLossPct);
  if (!(equity > 0) || !(cash > 0) || !(stopPct > 0)) return 0;

  const requestedRiskDollars = equity * c.cryptoV34RiskFraction;
  const portfolioRiskRoom = Math.max(
    0,
    equity * c.cryptoV34MaxPortfolioRiskFraction - Math.max(0, currentOpenRiskDollars),
  );
  const usableRiskDollars = Math.min(requestedRiskDollars, portfolioRiskRoom);
  if (!(usableRiskDollars > 0)) return 0;

  const totalRiskPct =
    stopPct + Math.max(0, Number(signal?.signal?.exitPlan?.estimatedRoundTripCostPct || 0));
  const riskSizedNotional = usableRiskDollars / (totalRiskPct / 100);
  const symbolCap = equity * c.cryptoV34MaxPositionFraction;
  const exposureRoom = Math.max(
    0,
    equity * c.cryptoV34MaxTotalExposureFraction - Math.max(0, currentCryptoExposure),
  );

  return Math.max(
    0,
    Math.min(riskSizedNotional, symbolCap, exposureRoom, cash * 0.95),
  );
}
