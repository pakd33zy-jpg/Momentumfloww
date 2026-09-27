export const CRYPTO_MACD_PEAK_DEFAULTS = Object.freeze({
  cryptoMacdPeakEnabled: true,
  cryptoMacdPeakMaxConcurrentPositions: 8,
  riskFraction: 0.01,
  maxPositionFractionOfEquity: 0.12,
  maxTotalCryptoExposureFraction: 0.70,
  maxOpenRiskFraction: 0.08,
  estimatedRoundTripCostPct: 0.10,

  // Validated 1h MACD valley/cross rules.
  troughLookbackBars: 200,
  minTroughDepthQuantile: 0.50,

  // Paper execution follows the tested MACD exit instead of forced price exits.
  emergencyStopLossPct: 0,
  maxHoldMinutes: 0,

  // Used only to size paper positions when no fixed stop is part of the strategy.
  riskSizingPct: 10.0,

  scaleInEnabled: false,
  maxEntriesPerSetup: 1,
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

function quantile(values = [], q = 0.5) {
  const rows = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!rows.length) return 0;
  const p = (rows.length - 1) * clamp(q, 0, 1);
  const lo = Math.floor(p);
  const hi = Math.ceil(p);
  if (lo === hi) return rows[lo];
  return rows[lo] + (rows[hi] - rows[lo]) * (p - lo);
}

function percentileRank(values = [], x = 0) {
  const rows = values.map(Number).filter(Number.isFinite);
  if (!rows.length) return 0;
  return rows.filter((v) => v <= x).length / rows.length;
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

function latestPattern(bars1h = [], config = {}, nowMs = Date.now()) {
  const cfg = { ...CRYPTO_MACD_PEAK_DEFAULTS, ...config };
  const bars = closedHourlyBars(bars1h, nowMs);
  const series = macdSeries(bars);
  const n = series.macd.length;
  const lookback = Math.max(50, Math.trunc(Number(cfg.troughLookbackBars || 200)));

  if (n < lookback + 4) {
    return {
      ok: false,
      reason: `MACD: need at least ${lookback + 4} closed 1h candles`,
      bars,
      series,
    };
  }

  // Latest closed candle is i. The candidate trough is i-2, followed by
  // two consecutive rising MACD closes at i-1 and i.
  const i = n - 1;
  const troughIndex = i - 2;
  const prior = series.macd[troughIndex - 1];
  const trough = series.macd[troughIndex];
  const rise1 = series.macd[troughIndex + 1];
  const rise2 = series.macd[troughIndex + 2];

  const depthHistory = series.macd
    .slice(troughIndex - lookback, troughIndex)
    .map((x) => Math.abs(Number(x)))
    .filter(Number.isFinite);

  const depthQuantile = clamp(cfg.minTroughDepthQuantile ?? 0.50, 0, 1);
  const depthThreshold = quantile(depthHistory, depthQuantile);
  const troughDepth = Math.abs(trough);
  const troughDepthPercentile = percentileRank(depthHistory, troughDepth);

  return {
    ok: true,
    bars,
    series,
    i,
    troughIndex,
    prior,
    trough,
    rise1,
    rise2,
    depthHistory,
    depthQuantile,
    depthThreshold,
    troughDepth,
    troughDepthPercentile,
    lastClose: series.closes[i],
    ema9: series.ema9[i],
    ema26: series.ema26[i],
  };
}

export function evaluateCryptoMacdPeakCandidate({ asset, snapshot, bars1h = [], config = {}, nowMs = Date.now() } = {}) {
  const cfg = { ...CRYPTO_MACD_PEAK_DEFAULTS, ...config };
  const symbol = String(asset?.symbol || '').toUpperCase();
  const price = Number(snapshot?.latestTrade?.p ?? snapshot?.minuteBar?.c ?? snapshot?.dailyBar?.c ?? 0);

  if (!symbol || !(price > 0)) {
    return { signal: null, reason: 'MACD: no tradable price', diagnostics: { score: 0 } };
  }
  if (cfg.cryptoMacdPeakEnabled === false) {
    return { signal: null, reason: 'MACD: strategy disabled', diagnostics: { score: 0 } };
  }

  const p = latestPattern(bars1h, cfg, nowMs);
  if (!p.ok) return { signal: null, reason: p.reason, diagnostics: { score: 0 } };

  const trough = p.trough < 0 && p.prior > p.trough;
  const twoRisingConfirmations = p.rise1 > p.trough && p.rise2 > p.rise1;
  const strongEnough = p.troughDepth >= p.depthThreshold;

  if (!(trough && twoRisingConfirmations && strongEnough)) {
    return {
      signal: null,
      reason: `MACD: waiting for below-zero valley + 2 rising confirmations + q${Math.round(p.depthQuantile * 100)} depth`,
      diagnostics: {
        score: 0,
        trough,
        twoRisingConfirmations,
        strongEnough,
        macdAtTrough: p.trough,
        troughDepth: p.troughDepth,
        depthThreshold: p.depthThreshold,
        troughDepthPercentile: p.troughDepthPercentile,
        ema9: p.ema9,
        ema26: p.ema26,
      },
    };
  }

  const depthRatio = p.depthThreshold > 0 ? p.troughDepth / p.depthThreshold : 1;
  const reboundRatio = p.troughDepth > 0 ? (p.rise2 - p.trough) / p.troughDepth : 0;
  const score = Number(clamp(
    6.0 + clamp(depthRatio - 1, 0, 2) * 1.2 + clamp(reboundRatio, 0, 1.5) * 1.2,
    6.0,
    9.9
  ).toFixed(2));

  return {
    signal: {
      symbol,
      name: asset?.name || symbol,
      assetClass: 'crypto',
      direction: 'LONG',
      strategy: 'CRYPTO_MACD_VALLEY_CROSS_PAPER',
      score,
      price,
      signal: {
        trigger: 'MACD_BELOW_ZERO_VALLEY_2_RISING_CLOSED_CANDLES_ADAPTIVE_DEPTH',
        timeframe: '1Hour',
        macd: { fast: 12, slow: 26, signal: 9 },
        valleyFilter: {
          lookbackBars: Math.max(50, Math.trunc(Number(cfg.troughLookbackBars || 200))),
          quantile: Number(p.depthQuantile.toFixed(4)),
          troughMacd: Number(p.trough.toFixed(8)),
          troughDepth: Number(p.troughDepth.toFixed(8)),
          requiredDepth: Number(p.depthThreshold.toFixed(8)),
          depthPercentile: Number(p.troughDepthPercentile.toFixed(4)),
        },
        scaleInPlan: {
          enabled: false,
          maxEntriesPerSetup: 1,
        },
        emaContext: {
          ema9: Number(p.ema9.toFixed(8)),
          ema26: Number(p.ema26.toFixed(8)),
          gateApplied: false,
        },
        exitPlan: {
          stopLossPct: 0,
          takeProfitPct: 0,
          trailTriggerPct: 0,
          trailDistancePct: 0,
          trailFloorPct: 0,
          maxHoldMinutes: 0,
          riskSizingPct: Math.max(1, Number(cfg.riskSizingPct || 10)),
          estimatedRoundTripCostPct: Math.max(0, Number(cfg.estimatedRoundTripCostPct || 0.10)),
          primaryExit: 'MACD_BEARISH_SIGNAL_CROSS_WHILE_MACD_ABOVE_ZERO',
        },
      },
    },
    reason: null,
    diagnostics: {
      score,
      macdAtTrough: p.trough,
      troughDepth: p.troughDepth,
      depthThreshold: p.depthThreshold,
      troughDepthPercentile: p.troughDepthPercentile,
      ema9: p.ema9,
      ema26: p.ema26,
    },
  };
}

export function evaluateCryptoMacdPeakExit({ bars1h = [], config = {}, nowMs = Date.now() } = {}) {
  const cfg = { ...CRYPTO_MACD_PEAK_DEFAULTS, ...config };
  const bars = closedHourlyBars(bars1h, nowMs);
  const series = macdSeries(bars);
  const n = series.macd.length;
  if (n < 3) return { exit: false, reason: 'MACD: not enough closed 1h candles for exit' };

  const prev = n - 2;
  const curr = n - 1;
  const bearishCrossAboveZero =
    series.macd[prev] >= series.signal[prev] &&
    series.macd[curr] < series.signal[curr] &&
    series.macd[curr] > 0;

  return {
    exit: Boolean(bearishCrossAboveZero),
    reason: bearishCrossAboveZero
      ? 'MACD bearish signal-line cross confirmed while MACD is above zero'
      : 'MACD bearish-cross exit not confirmed',
    diagnostics: {
      macdPrev: series.macd[prev],
      signalPrev: series.signal[prev],
      macd: series.macd[curr],
      signal: series.signal[curr],
      timeframe: '1Hour',
      costAssumptionPct: Math.max(0, Number(cfg.estimatedRoundTripCostPct || 0.10)),
    },
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
  const sizingRiskPct = Math.max(
    1,
    Number(signal?.signal?.exitPlan?.riskSizingPct || cfg.riskSizingPct || 10)
  );
  const costPct = Math.max(
    0,
    Number(signal?.signal?.exitPlan?.estimatedRoundTripCostPct || cfg.estimatedRoundTripCostPct || 0.10)
  );

  const riskRoom = Math.max(0, e * maxRiskFraction - Math.max(0, Number(currentOpenRiskDollars || 0)));
  const desiredRisk = Math.min(e * riskFraction, riskRoom);
  if (!(desiredRisk > 0)) return 0;

  const riskSized = desiredRisk / ((sizingRiskPct + costPct) / 100);
  const exposureRoom = Math.max(0, e * maxExposureFraction - Math.max(0, Number(currentCryptoExposure || 0)));
  return Math.max(0, Math.min(riskSized, e * maxPositionFraction, exposureRoom, c * 0.90));
}
