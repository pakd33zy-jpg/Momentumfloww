// CRYPTO STRATEGY V33 — fee-aware multi-timeframe trend/pullback strategy.
//
// This module is intentionally pure so it can be replay-tested without an
// Alpaca connection. Crypto remains LONG/cash because Alpaca crypto is spot.

export const CRYPTO_V33_DEFAULTS = {
  cryptoV33Enabled: true,
  cryptoV33Symbols: [
    'BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD',
    'AVAX/USD', 'LTC/USD', 'BCH/USD', 'DOGE/USD',
  ],
  cryptoV33MaxSpreadPct: 0.22,
  cryptoV33EstimatedRoundTripCostPct: 0.50,
  cryptoV33MinNetEdgePct: 0.35,
  cryptoV33MinScore: 7,
  cryptoV33DailyFastEma: 7,
  cryptoV33DailySlowEma: 28,
  cryptoV33HourlyFastEma: 12,
  cryptoV33HourlySlowEma: 36,
  cryptoV33PullbackEma: 20,
  cryptoV33Recovery7dPct: 4.0,
  cryptoV33Recovery24hPct: 0.50,
  cryptoV33AtrStopMultiple: 1.8,
  cryptoV33MinStopPct: 1.25,
  cryptoV33MaxStopPct: 4.0,
  cryptoV33RewardRisk: 2.0,
  cryptoV33MaxHoldMinutes: 3 * 24 * 60,
  cryptoV33TrailTriggerR: 1.0,
  cryptoV33TrailDistanceR: 0.65,
  cryptoV33MaxPositionFraction: 0.12,
  cryptoV33MaxTotalExposureFraction: 0.35,
  cryptoV33RiskFraction: 0.0025,
};

const number = (value, fallback = NaN) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

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

function rejection(reason, metrics = {}) {
  const detail = { eligible: false, score: 0, reason, ...metrics };
  return {
    signal: null,
    diagnostics: {
      eligible: false,
      reason,
      metrics,
      long: detail,
      threshold: null,
    },
  };
}

export function evaluateCryptoCandidateV33({
  asset,
  snapshot,
  bars15m,
  bars1h,
  bars1d,
  config = {},
}) {
  const c = { ...CRYPTO_V33_DEFAULTS, ...config };
  const symbol = String(asset?.symbol || '');
  if (!c.cryptoV33Symbols.includes(symbol)) return rejection('V33: outside liquid crypto universe');

  const b15 = validBars(bars15m);
  const b1h = validBars(bars1h);
  let b1d = validBars(bars1d);
  let dailySource = '1Day';
  if (b1d.length < 35) {
    const derivedDaily = aggregateHourlyToDaily(b1h);
    if (derivedDaily.length > b1d.length) {
      b1d = derivedDaily;
      dailySource = 'derived_from_1Hour';
    }
  }
  if (b15.length < 40 || b1h.length < 50 || b1d.length < 35) {
    const historyReason =
      `V33: insufficient history ` +
      `(15m=${b15.length}, 1h=${b1h.length}, 1d=${b1d.length}, source=${dailySource})`;
    return rejection(historyReason, {
      bars15m: b15.length,
      bars1h: b1h.length,
      bars1d: b1d.length,
      dailySource,
    });
  }

  const bid = number(snapshot?.latestQuote?.bp ?? snapshot?.bp);
  const ask = number(snapshot?.latestQuote?.ap ?? snapshot?.ap);
  const price = ask > 0 ? ask : close(b15.at(-1));
  const spread = bid > 0 && ask > 0 ? (ask - bid) / ((ask + bid) / 2) * 100 : null;
  if (spread == null || spread > c.cryptoV33MaxSpreadPct) {
    return rejection('V33: spread above liquid-market limit', { spreadPct: spread });
  }

  const dailyCloses = b1d.map(close);
  const hourlyCloses = b1h.map(close);
  const closes15 = b15.map(close);
  const dFast = ema(dailyCloses, c.cryptoV33DailyFastEma);
  const dSlow = ema(dailyCloses, c.cryptoV33DailySlowEma);
  const hFast = ema(hourlyCloses, c.cryptoV33HourlyFastEma);
  const hSlow = ema(hourlyCloses, c.cryptoV33HourlySlowEma);
  const pullbackEma = ema(closes15, c.cryptoV33PullbackEma);
  const ret7d = returnPct(b1d, 7);
  const ret28d = returnPct(b1d, 28);
  const ret6h = returnPct(b1h, 6);
  const ret24h = returnPct(b1h, 24);
  const volRatio = volumeRatio(b15);

  const establishedDailyTrend =
    price > dSlow &&
    dFast > dSlow &&
    ret7d > 0 &&
    ret28d > 0;

  // A sharp recovery should not have to wait weeks for a 28-day measure to
  // turn positive. It must still reclaim the fast daily EMA and have strong
  // 7-day plus 24-hour confirmation; the 15-minute trigger below prevents a
  // market-order chase into an extended candle.
  const recoveryDailyTrend =
    price > dFast &&
    ret7d >= c.cryptoV33Recovery7dPct &&
    ret24h >= c.cryptoV33Recovery24hPct;

  const dailyTrend =
    establishedDailyTrend ||
    recoveryDailyTrend;
  const hourlyTrend = hFast > hSlow && ret24h > 0;
  if (!dailyTrend || !hourlyTrend) {
    return rejection('V33: higher-timeframe trend not aligned', {
      ret7d,
      ret28d,
      ret24h,
      dailyFast: dFast,
      dailySlow: dSlow,
      establishedDailyTrend,
      recoveryDailyTrend,
      hourlyTrend,
    });
  }

  const latest = close(b15.at(-1));
  const previous = close(b15.at(-2));
  const recentHigh = Math.max(...b15.slice(-9, -1).map(high));
  const recentLow = Math.min(...b15.slice(-9, -1).map(low));
  const reclaim = previous <= pullbackEma && latest > pullbackEma;
  const shallowPullback = recentLow <= pullbackEma * 1.004 && latest > pullbackEma && ret6h > -0.5;
  const breakout = latest > recentHigh && ret6h > 0;
  if (!reclaim && !shallowPullback && !breakout) {
    return rejection('V33: waiting for 15m pullback/reclaim or breakout', {
      latest, pullbackEma, recentHigh, reclaim, shallowPullback, breakout,
    });
  }

  const volatility = atrPct(b1h);
  if (volatility == null) return rejection('V33: hourly ATR unavailable');
  const stopLossPct = Math.min(
    c.cryptoV33MaxStopPct,
    Math.max(c.cryptoV33MinStopPct, volatility * c.cryptoV33AtrStopMultiple),
  );
  const takeProfitPct = stopLossPct * c.cryptoV33RewardRisk + c.cryptoV33EstimatedRoundTripCostPct;
  const expectedMovePct = Math.max(
    Math.abs(ret24h || 0) * 0.45,
    volatility * 1.5,
  );
  const requiredMovePct = c.cryptoV33EstimatedRoundTripCostPct + c.cryptoV33MinNetEdgePct;
  if (expectedMovePct < requiredMovePct) {
    return rejection('V33: expected move does not clear fees and edge buffer', {
      expectedMovePct, requiredMovePct,
    });
  }

  const components = {
    dailyTrend: dailyTrend ? 2 : 0,
    hourlyTrend: hourlyTrend ? 2 : 0,
    trigger: reclaim || shallowPullback ? 2 : 1,
    momentum: ret24h > 1 ? 1 : 0,
    volume: volRatio != null && volRatio >= 1.05 ? 1 : 0,
    spread: spread <= 0.10 ? 1 : 0,
    feeEdge: expectedMovePct >= requiredMovePct * 1.5 ? 1 : 0,
  };
  const score = Object.values(components).reduce((sum, value) => sum + value, 0);
  if (score < c.cryptoV33MinScore) return rejection('V33: setup score below threshold', { score, components });

  const trigger = reclaim ? '15M_RECLAIM' : shallowPullback ? '15M_PULLBACK' : '15M_BREAKOUT';
  const detail = {
    eligible: true,
    score,
    reason: null,
    trigger,
    components,
    spreadPct: spread,
    ret7dPct: ret7d,
    ret28dPct: ret28d,
    ret24hPct: ret24h,
    ret6hPct: ret6h,
    trendRegime:
      establishedDailyTrend
        ? 'ESTABLISHED_TREND'
        : 'CONFIRMED_RECOVERY',
    hourlyAtrPct: volatility,
    expectedMovePct,
    estimatedRoundTripCostPct: c.cryptoV33EstimatedRoundTripCostPct,
    dailySource,
    exitPlan: {
      stopLossPct,
      takeProfitPct,
      trailTriggerPct: stopLossPct * c.cryptoV33TrailTriggerR,
      trailDistancePct: stopLossPct * c.cryptoV33TrailDistanceR,
      trailFloorPct: Math.max(c.cryptoV33EstimatedRoundTripCostPct + 0.10, stopLossPct * 0.35),
      maxHoldMinutes: c.cryptoV33MaxHoldMinutes,
      estimatedRoundTripCostPct: c.cryptoV33EstimatedRoundTripCostPct,
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
      strategy: 'CRYPTO_V33_TREND_PULLBACK',
      signal: detail,
    },
    diagnostics: { eligible: true, reason: null, metrics: detail },
  };
}

export function buildCryptoV33Budget({ equity, cash, currentCryptoExposure = 0, signal, config = {} }) {
  const c = { ...CRYPTO_V33_DEFAULTS, ...config };
  const stopPct = number(signal?.signal?.exitPlan?.stopLossPct);
  if (!(equity > 0) || !(cash > 0) || !(stopPct > 0)) return 0;
  const riskBudget = equity * c.cryptoV33RiskFraction / (stopPct / 100);
  const symbolCap = equity * c.cryptoV33MaxPositionFraction;
  const portfolioRoom = Math.max(0, equity * c.cryptoV33MaxTotalExposureFraction - currentCryptoExposure);
  return Math.max(0, Math.min(riskBudget, symbolCap, portfolioRoom, cash * 0.95));
}
