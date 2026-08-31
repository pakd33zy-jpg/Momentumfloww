// CRYPTO STRATEGY V35 — standalone crypto evidence model.
// No V33/V34 strategy imports. Crypto remains LONG/cash for Alpaca spot.

export const CRYPTO_V35_DEFAULTS = {
  cryptoV35Enabled: true,
  cryptoV35MinScore: 5.4,
  cryptoV35RiskFraction: 0.01,
  cryptoV35MaxPortfolioRiskFraction: 0.08,
  cryptoV35MaxPositionFraction: 0.20,
  cryptoV35MaxTotalExposureFraction: 0.80,
  cryptoV35MaxConcurrentPositions: 8,
  cryptoV35EstimatedRoundTripCostPct: 0.50,
  cryptoV35PreferredSpreadPct: 0.20,
  cryptoV35MinStopPct: 1.0,
  cryptoV35MaxStopPct: 5.5,
  cryptoV35AtrStopMultiple: 1.8,
  cryptoV35RewardRisk: 1.9,
  cryptoV35MaxHoldMinutes: 3 * 24 * 60,
  cryptoV35TrailTriggerR: 1.0,
  cryptoV35TrailDistanceR: 0.65,
};

const n = (v, fallback = NaN) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const close = (bar) => n(bar?.c ?? bar?.close);
const high = (bar) => n(bar?.h ?? bar?.high);
const low = (bar) => n(bar?.l ?? bar?.low);
const volume = (bar) => n(bar?.v ?? bar?.volume, 0);
const stampMs = (bar) => {
  const value = bar?.t ?? bar?.timestamp;
  const ms = new Date(value ?? 0).getTime();
  return Number.isFinite(ms) ? ms : NaN;
};

function validBars(bars = []) {
  return (bars || []).filter((bar) => close(bar) > 0);
}

function retPct(bars = [], lookback = 1) {
  const rows = validBars(bars);
  if (rows.length <= lookback) return 0;
  const last = close(rows.at(-1));
  const prior = close(rows.at(-(lookback + 1)));
  return prior > 0 ? (last / prior - 1) * 100 : 0;
}

function retPctWindow(bars = [], windowMs, fallbackLookback = 1) {
  const rows = validBars(bars);
  if (rows.length < 2 || !(windowMs > 0)) return 0;
  const lastRow = rows.at(-1);
  const lastTs = stampMs(lastRow);
  if (!Number.isFinite(lastTs)) return retPct(rows, fallbackLookback);
  const cutoff = lastTs - windowMs;
  let prior = null;
  for (let i = rows.length - 2; i >= 0; i -= 1) {
    const ts = stampMs(rows[i]);
    if (Number.isFinite(ts) && ts <= cutoff) {
      prior = rows[i];
      break;
    }
  }
  if (!prior) return retPct(rows, Math.min(fallbackLookback, rows.length - 1));
  const last = close(lastRow);
  const base = close(prior);
  return base > 0 ? (last / base - 1) * 100 : 0;
}

function avg(xs = []) {
  const good = xs.filter(Number.isFinite);
  return good.length ? good.reduce((a, b) => a + b, 0) / good.length : 0;
}

function ema(values = [], length = 12) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < length || length < 2) return null;
  const alpha = 2 / (length + 1);
  let out = clean.slice(0, length).reduce((a, b) => a + b, 0) / length;
  for (const x of clean.slice(length)) out = x * alpha + out * (1 - alpha);
  return out;
}

function atrPct(bars = [], length = 14) {
  const rows = validBars(bars);
  if (rows.length < length + 1) return 0;
  const trs = [];
  for (let i = rows.length - length; i < rows.length; i += 1) {
    const prev = close(rows[i - 1]);
    const hi = high(rows[i]);
    const lo = low(rows[i]);
    trs.push(Math.max(hi - lo, Math.abs(hi - prev), Math.abs(lo - prev)));
  }
  const price = close(rows.at(-1));
  return price > 0 ? avg(trs) / price * 100 : 0;
}

function volumeRatio(bars = [], lookback = 20) {
  const rows = validBars(bars);
  if (rows.length < lookback + 1) return 1;
  const current = volume(rows.at(-1));
  const base = avg(rows.slice(-(lookback + 1), -1).map(volume).filter((x) => x > 0));
  return base > 0 && current > 0 ? current / base : 1;
}

function snapshotSpreadPct(snapshot = {}) {
  const bid = n(snapshot?.latestQuote?.bp ?? snapshot?.bp);
  const ask = n(snapshot?.latestQuote?.ap ?? snapshot?.ap);
  if (!(bid > 0) || !(ask > 0) || ask < bid) return null;
  return (ask - bid) / ((ask + bid) / 2) * 100;
}

function intelligenceScore(intelligence) {
  if (!intelligence || typeof intelligence !== 'object') return 0;
  const raw = n(
    intelligence?.netScore ??
    intelligence?.directionalScore ??
    intelligence?.score ??
    intelligence?.catalystScore,
    0,
  );
  return clamp(raw * 0.10, -0.6, 0.6);
}

function deriveDailyFromHourly(bars1h = []) {
  const groups = new Map();
  for (const bar of validBars(bars1h)) {
    const stamp = new Date(bar?.t ?? bar?.timestamp ?? 0);
    if (!Number.isFinite(stamp.getTime())) continue;
    const key = stamp.toISOString().slice(0, 10);
    const row = groups.get(key);
    if (!row) {
      groups.set(key, { t: `${key}T00:00:00.000Z`, h: high(bar), l: low(bar), c: close(bar), v: volume(bar) });
    } else {
      row.h = Math.max(row.h, high(bar));
      row.l = Math.min(row.l, low(bar));
      row.c = close(bar);
      row.v += volume(bar);
    }
  }
  return [...groups.values()];
}

export function evaluateCryptoCandidateV35({
  asset,
  snapshot,
  bars15m,
  bars1h,
  bars1d,
  btcBars1h = [],
  intelligence = null,
  config = {},
}) {
  const settings = { ...CRYPTO_V35_DEFAULTS, ...config };
  const symbol = String(asset?.symbol || '').toUpperCase();
  if (!symbol) return { signal: null, reason: 'V35: missing symbol', diagnostics: { hardReject: true, reason: 'missing symbol' } };
  if (asset?.tradable === false) return { signal: null, reason: 'V35: asset not tradable', diagnostics: { hardReject: true, reason: 'asset not tradable' } };

  const b15 = validBars(bars15m);
  const b1h = validBars(bars1h);
  let b1d = validBars(bars1d);
  if (b1d.length < 28) {
    const derived = deriveDailyFromHourly(b1h);
    if (derived.length > b1d.length) b1d = derived;
  }

  if (b15.length < 24 || b1h.length < 30 || b1d.length < 20) {
    return {
      signal: null,
      reason: `V35: insufficient market history (15m=${b15.length},1h=${b1h.length},1d=${b1d.length})`,
      diagnostics: { hardReject: true, reason: 'insufficient market history', bars15m: b15.length, bars1h: b1h.length, bars1d: b1d.length },
    };
  }

  const price = n(snapshot?.latestTrade?.p ?? snapshot?.minuteBar?.c ?? close(b15.at(-1)));
  if (!(price > 0)) return { signal: null, reason: 'V35: invalid price', diagnostics: { hardReject: true, reason: 'invalid price' } };

  const spread = snapshotSpreadPct(snapshot);
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const ret1h = retPctWindow(b15, HOUR, 4);
  const ret3h = retPctWindow(b15, 3 * HOUR, 12);
  const ret6h = retPctWindow(b1h, 6 * HOUR, 6);
  const ret24h = retPctWindow(b1h, DAY, 24);
  const ret7d = retPctWindow(b1d, 7 * DAY, 7);
  const ret20d = retPctWindow(b1d, 20 * DAY, Math.min(20, b1d.length - 1));
  const btc6h = retPctWindow(btcBars1h, 6 * HOUR, 6);
  const btc24h = retPctWindow(btcBars1h, DAY, 24);
  const relative6h = ret6h - btc6h;
  const relative24h = ret24h - btc24h;
  const vr = volumeRatio(b15);
  const atr = atrPct(b1h);

  const closes15 = b15.map(close);
  const fast15 = ema(closes15, 8);
  const slow15 = ema(closes15, 20);
  const latest = close(b15.at(-1));
  const previous = close(b15.at(-2));
  const recentHigh = Math.max(...b15.slice(-9, -1).map(high));

  const reclaim = previous <= slow15 && latest > slow15 && latest > previous;
  const breakout = latest > recentHigh && ret1h > 0;
  const continuation = fast15 > slow15 && latest > fast15 && ret1h > 0;
  const trigger = reclaim ? '15M_RECLAIM' : breakout ? '15M_BREAKOUT' : continuation ? '15M_CONTINUATION' : latest > slow15 && ret1h > 0 ? '15M_POSITIVE_STRUCTURE' : 'NO_CLEAN_TRIGGER';

  let score = 2.2;
  score += ret1h > 0.8 ? 1.0 : ret1h > 0.25 ? 0.65 : ret1h > 0 ? 0.30 : ret1h < -0.75 ? -0.65 : -0.20;
  score += ret6h > 2 ? 0.95 : ret6h > 0.5 ? 0.60 : ret6h > 0 ? 0.25 : ret6h < -2 ? -0.75 : -0.25;
  score += ret24h > 3 ? 0.90 : ret24h > 1 ? 0.55 : ret24h > 0 ? 0.20 : ret24h < -3 ? -0.85 : -0.25;
  score += ret7d > 5 ? 0.75 : ret7d > 0 ? 0.30 : ret7d < -8 ? -0.55 : -0.15;
  score += ret20d > 0 ? 0.25 : -0.10;
  score += relative24h > 4 ? 1.0 : relative24h > 1 ? 0.65 : relative24h > 0 ? 0.25 : relative24h < -3 ? -0.75 : -0.20;
  score += relative6h > 1 ? 0.45 : relative6h > 0 ? 0.20 : relative6h < -1.5 ? -0.40 : 0;
  score += vr >= 2 ? 0.75 : vr >= 1.25 ? 0.50 : vr >= 0.85 ? 0.15 : -0.20;
  score += reclaim ? 1.0 : breakout ? 0.9 : continuation ? 0.65 : trigger === '15M_POSITIVE_STRUCTURE' ? 0.25 : -0.20;
  score += intelligenceScore(intelligence);

  if (spread != null) {
    const preferred = n(settings.cryptoV35PreferredSpreadPct, 0.20);
    if (spread <= preferred) score += 0.30;
    else if (spread <= preferred * 2) score += 0.05;
    else if (spread <= 1.0) score -= 0.30;
    else score -= clamp((spread - 1.0) * 0.6, 0.3, 1.5);
  }

  score = Number(clamp(score, 0, 10).toFixed(2));
  const threshold = n(settings.cryptoV35MinScore, 5.4);
  const baseCost = Math.max(0, n(settings.cryptoV35EstimatedRoundTripCostPct, 0.50));
  const modeledCost = baseCost + Math.max(0, n(spread, 0) * 0.35);
  const stopLossPct = clamp(
    Math.max(n(settings.cryptoV35MinStopPct, 1.0), atr * n(settings.cryptoV35AtrStopMultiple, 1.8)),
    n(settings.cryptoV35MinStopPct, 1.0),
    n(settings.cryptoV35MaxStopPct, 5.5),
  );
  const takeProfitPct = Math.max(
    stopLossPct * n(settings.cryptoV35RewardRisk, 1.9) + modeledCost,
    modeledCost * 2.5,
  );

  const evidence = [
    `move 1h/6h/24h ${ret1h.toFixed(3)}/${ret6h.toFixed(3)}/${ret24h.toFixed(3)}%`,
    `relative BTC 6h/24h ${relative6h.toFixed(3)}/${relative24h.toFixed(3)}%`,
    `7d/20d ${ret7d.toFixed(3)}/${ret20d.toFixed(3)}%`,
    `${trigger} volume x${vr.toFixed(2)} spread ${Number.isFinite(spread) ? spread.toFixed(3) : 'n/a'}%`,
  ];

  if (trigger === 'NO_CLEAN_TRIGGER' || score < threshold) {
    const reason = trigger === 'NO_CLEAN_TRIGGER'
      ? 'V35: no clean 15m trigger'
      : 'V35: combined crypto evidence below threshold';
    return {
      signal: null,
      reason,
      diagnostics: {
        eligible: false,
        hardReject: false,
        reason,
        score,
        threshold,
        metrics: { ret1hPct: ret1h, ret3hPct: ret3h, ret6hPct: ret6h, ret24hPct: ret24h, ret7dPct: ret7d, ret20dPct: ret20d, btc6hPct: btc6h, btc24hPct: btc24h, relative6hPct: relative6h, relative24hPct: relative24h, volumeRatio: vr, spreadPct: spread, atrPct: atr, trigger, evidence },
      },
    };
  }

  return {
    signal: {
      symbol,
      name: asset?.name || symbol,
      assetClass: 'crypto',
      direction: 'LONG',
      score,
      price,
      strategy: 'CRYPTO_V35_STANDALONE',
      signal: {
        version: 'V35',
        playbook: trigger,
        trigger,
        evidence,
        ret1hPct: ret1h,
        ret6hPct: ret6h,
        ret24hPct: ret24h,
        btc6hPct: btc6h,
        btc24hPct: btc24h,
        relative6hPct: relative6h,
        relative24hPct: relative24h,
        observedSpreadPct: spread,
        exitPlan: {
          stopLossPct: Number(stopLossPct.toFixed(4)),
          takeProfitPct: Number(takeProfitPct.toFixed(4)),
          estimatedRoundTripCostPct: Number(modeledCost.toFixed(4)),
          trailTriggerPct: Number((stopLossPct * n(settings.cryptoV35TrailTriggerR, 1.0)).toFixed(4)),
          trailDistancePct: Number((stopLossPct * n(settings.cryptoV35TrailDistanceR, 0.65)).toFixed(4)),
          trailFloorPct: Number(Math.max(0.6, modeledCost + 0.15).toFixed(4)),
          maxHoldMinutes: Math.max(60, n(settings.cryptoV35MaxHoldMinutes, 3 * 24 * 60)),
        },
      },
    },
    diagnostics: {
      eligible: true,
      hardReject: false,
      reason: null,
      score,
      threshold,
      metrics: { ret1hPct: ret1h, ret3hPct: ret3h, ret6hPct: ret6h, ret24hPct: ret24h, ret7dPct: ret7d, ret20dPct: ret20d, btc6hPct: btc6h, btc24hPct: btc24h, relative6hPct: relative6h, relative24hPct: relative24h, volumeRatio: vr, spreadPct: spread, atrPct: atr, trigger, evidence },
    },
    reason: null,
  };
}

export function buildCryptoV35Budget({
  equity,
  cash,
  currentCryptoExposure = 0,
  currentOpenRiskDollars = 0,
  signal,
  config = {},
}) {
  const settings = { ...CRYPTO_V35_DEFAULTS, ...config };
  const stopPct = n(signal?.signal?.exitPlan?.stopLossPct);
  if (!(equity > 0) || !(cash > 0) || !(stopPct > 0)) return 0;

  const requestedRiskDollars = equity * n(settings.cryptoV35RiskFraction, 0.01);
  const portfolioRiskRoom = Math.max(
    0,
    equity * n(settings.cryptoV35MaxPortfolioRiskFraction, 0.08) - Math.max(0, currentOpenRiskDollars),
  );
  const usableRiskDollars = Math.min(requestedRiskDollars, portfolioRiskRoom);
  if (!(usableRiskDollars > 0)) return 0;

  const costPct = Math.max(0, n(signal?.signal?.exitPlan?.estimatedRoundTripCostPct, 0.50));
  const riskSizedNotional = usableRiskDollars / ((stopPct + costPct) / 100);
  const symbolCap = equity * n(settings.cryptoV35MaxPositionFraction, 0.20);
  const exposureRoom = Math.max(
    0,
    equity * n(settings.cryptoV35MaxTotalExposureFraction, 0.80) - Math.max(0, currentCryptoExposure),
  );

  return Math.max(0, Math.min(riskSizedNotional, symbolCap, exposureRoom, cash * 0.95));
}