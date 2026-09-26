export const CRYPTO_MACD_PEAK_DEFAULTS = Object.freeze({
  cryptoMacdPeakEnabled: true,
  cryptoMacdPeakMaxConcurrentPositions: 8,
  riskFraction: 0.01,
  maxPositionFractionOfEquity: 0.12,
  maxTotalCryptoExposureFraction: 0.70,
  maxOpenRiskFraction: 0.08,
  estimatedRoundTripCostPct: 0.10,
  emergencyStopLossPct: 3.0,
  maxHoldMinutes: 10080,
  minTroughHistogramPct: 0.02,
});

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, Number(x) || 0));
const closeOf = (bar) => Number(bar?.c ?? bar?.close ?? 0);

function barTime(bar) {
  const raw = bar?.t ?? bar?.timestamp ?? bar?.time ?? null;
  if (!raw) return NaN;
  return new Date(raw).getTime();
}

export function closedHourlyBars(bars = [], nowMs = Date.now()) {
  const rows = Array.isArray(bars) ? bars.filter((b) => closeOf(b) > 0) : [];
  if (!rows.length) return [];
  const timed = rows.filter((b) => Number.isFinite(barTime(b)));
  if (timed.length === rows.length) {
    return rows.filter((b) => barTime(b) + 60 * 60 * 1000 <= nowMs);
  }
  return rows.length > 1 ? rows.slice(0, -1) : [];
}

function ema(values = [], period = 9) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = [Number(values[0])];
  for (let i = 1; i < values.length; i += 1) {
    out.push(Number(values[i]) * k + out[i - 1] * (1 - k));
  }
  return out;
}

export function macdSeries(bars = []) {
  const closes = bars.map(closeOf).filter((x) => x > 0);
  if (closes.length < 35) return { closes, macd: [], signal: [], histogram: [], ema9: [], ema26: [] };
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const macd = closes.map((_, i) => fast[i] - slow[i]);
  const signal = ema(macd, 9);
  const histogram = macd.map((x, i) => x - signal[i]);
  return { closes, macd, signal, histogram, ema9: ema(closes, 9), ema26: slow };
}

function latestPattern(bars1h = [], nowMs = Date.now()) {
  const bars = closedHourlyBars(bars1h, nowMs);
  const series = macdSeries(bars);
  const n = series.histogram.length;
  if (n < 40) return { ok: false, reason: 'MACD: not enough closed 1h candles', bars, series };
  const h0 = series.histogram[n - 4];
  const h1 = series.histogram[n - 3];
  const h2 = series.histogram[n - 2];
  const h3 = series.histogram[n - 1];
  const m1 = series.macd[n - 3];
  const close1 = series.closes[n - 3];
  const histPct = close1 > 0 ? (h1 / close1) * 100 : 0;
  return {
    ok: true,
    bars,
    series,
    h0,
    h1,
    h2,
    h3,
    m1,
    histPct,
    lastClose: series.closes[n - 1],
    ema9: series.ema9[n - 1],
    ema26: series.ema26[n - 1],
  };
}

export function evaluateCryptoMacdPeakCandidate({ asset, snapshot, bars1h = [], config = {}, nowMs = Date.now() } = {}) {
  const cfg = { ...CRYPTO_MACD_PEAK_DEFAULTS, ...config };
  const symbol = String(asset?.symbol || '').toUpperCase();
  const price = Number(snapshot?.latestTrade?.p ?? snapshot?.minuteBar?.c ?? snapshot?.dailyBar?.c ?? 0);
  if (!symbol || !(price > 0)) return { signal: null, reason: 'MACD: no tradable price', diagnostics: { score: 0 } };
  if (cfg.cryptoMacdPeakEnabled === false) return { signal: null, reason: 'MACD: strategy disabled', diagnostics: { score: 0 } };

  const p = latestPattern(bars1h, nowMs);
  if (!p.ok) return { signal: null, reason: p.reason, diagnostics: { score: 0 } };

  const minDepth = Math.max(0.001, Number(cfg.minTroughHistogramPct || 0.02));
  const trough = p.h1 < p.h0 && p.h1 < 0 && p.m1 < 0;
  const confirmed = p.h2 > p.h1 && p.h3 > p.h2;
  const strongEnough = Math.abs(p.histPct) >= minDepth;

  if (!(trough && confirmed && strongEnough)) {
    return {
      signal: null,
      reason: `MACD: waiting for confirmed below-zero trough (depth ${Math.abs(p.histPct).toFixed(4)}%)`,
      diagnostics: {
        score: 0,
        trough,
        confirmed,
        strongEnough,
        histogramPct: p.histPct,
        ema9: p.ema9,
        ema26: p.ema26,
      },
    };
  }

  const rebound = p.lastClose > 0 ? ((p.h3 - p.h1) / p.lastClose) * 100 : 0;
  const depthScore = clamp(Math.abs(p.histPct) / Math.max(minDepth, 0.001), 1, 3);
  const reboundScore = clamp(rebound / Math.max(minDepth, 0.001), 0, 3);
  const score = Number(clamp(5.5 + depthScore * 0.9 + reboundScore * 0.6, 5.5, 9.9).toFixed(2));

  return {
    signal: {
      symbol,
      name: asset?.name || symbol,
      assetClass: 'crypto',
      direction: 'LONG',
      strategy: 'CRYPTO_MACD_PEAK_PAPER',
      score,
      price,
      signal: {
        trigger: 'MACD_BELOW_ZERO_TROUGH_2_CLOSED_CANDLE_CONFIRMATION',
        timeframe: '1Hour',
        macd: { fast: 12, slow: 26, signal: 9 },
        histogramPctAtTrough: Number(p.histPct.toFixed(6)),
        emaContext: {
          ema9: Number(p.ema9.toFixed(8)),
          ema26: Number(p.ema26.toFixed(8)),
          gateApplied: false,
        },
        exitPlan: {
          stopLossPct: Math.max(0.5, Number(cfg.emergencyStopLossPct || 3.0)),
          takeProfitPct: 0,
          trailTriggerPct: 0,
          trailDistancePct: 0,
          trailFloorPct: 0,
          maxHoldMinutes: Math.max(1440, Number(cfg.maxHoldMinutes || 10080)),
          estimatedRoundTripCostPct: Math.max(0, Number(cfg.estimatedRoundTripCostPct || 0.10)),
          primaryExit: 'MACD_ABOVE_ZERO_PEAK_2_CLOSED_CANDLE_CONFIRMATION',
        },
      },
    },
    reason: null,
    diagnostics: { score, histogramPct: p.histPct, reboundPct: rebound, ema9: p.ema9, ema26: p.ema26 },
  };
}

export function evaluateCryptoMacdPeakExit({ bars1h = [], nowMs = Date.now() } = {}) {
  const p = latestPattern(bars1h, nowMs);
  if (!p.ok) return { exit: false, reason: p.reason };
  const peak = p.h1 > p.h0 && p.h1 > 0 && p.m1 > 0;
  const confirmed = p.h2 < p.h1 && p.h3 < p.h2;
  return {
    exit: Boolean(peak && confirmed),
    reason: peak && confirmed
      ? 'MACD above-zero peak confirmed by 2 closed 1h candles'
      : 'MACD peak exit not confirmed',
    diagnostics: { peak, confirmed, histogramPct: p.histPct },
  };
}

export function buildCryptoMacdPeakBudget({ equity, cash, currentCryptoExposure = 0, currentOpenRiskDollars = 0, signal, config = {} } = {}) {
  const cfg = { ...CRYPTO_MACD_PEAK_DEFAULTS, ...config };
  const e = Math.max(0, Number(equity || 0));
  const c = Math.max(0, Number(cash || 0));
  if (!(e > 0) || !(c > 0)) return 0;
  const riskFraction = clamp(cfg.riskFraction, 0.001, 0.02);
  const maxPositionFraction = clamp(cfg.maxPositionFractionOfEquity, 0.01, 0.25);
  const maxExposureFraction = clamp(cfg.maxTotalCryptoExposureFraction, 0.10, 0.95);
  const maxRiskFraction = clamp(cfg.maxOpenRiskFraction, 0.01, 0.15);
  const stopPct = Math.max(0.5, Number(signal?.signal?.exitPlan?.stopLossPct || cfg.emergencyStopLossPct || 3));
  const costPct = Math.max(0, Number(signal?.signal?.exitPlan?.estimatedRoundTripCostPct || cfg.estimatedRoundTripCostPct || 0.10));
  const riskRoom = Math.max(0, e * maxRiskFraction - Math.max(0, Number(currentOpenRiskDollars || 0)));
  const desiredRisk = Math.min(e * riskFraction, riskRoom);
  if (!(desiredRisk > 0)) return 0;
  const riskSized = desiredRisk / ((stopPct + costPct) / 100);
  const exposureRoom = Math.max(0, e * maxExposureFraction - Math.max(0, Number(currentCryptoExposure || 0)));
  return Math.max(0, Math.min(riskSized, e * maxPositionFraction, exposureRoom, c * 0.90));
}
