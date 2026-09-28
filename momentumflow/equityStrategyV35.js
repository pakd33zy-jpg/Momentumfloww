// PAPER-ONLY equity MACD valley/cross strategy.
// Kept behind the existing V35 export names for runtime compatibility.

export const EQUITY_V35_DEFAULTS = Object.freeze({
  equityV35Enabled: true,
  equityMacdTimeframe: '5Min',
  equityMacdLookbackBars: 200,
  equityMacdDepthQuantile: 0.50,
  equityMacdEstimatedRoundTripCostPct: 0.04,
  equityMacdMaxPositionFraction: 0.15,
  equityMacdSizingRiskPct: 2.0,
});

const closeOf = (bar) => Number(bar?.c ?? bar?.close ?? 0);

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
  const p = (rows.length - 1) * Math.max(0, Math.min(1, Number(q) || 0));
  const lo = Math.floor(p);
  const hi = Math.ceil(p);
  if (lo === hi) return rows[lo];
  return rows[lo] + (rows[hi] - rows[lo]) * (p - lo);
}

function macdSeries(bars = []) {
  const closes = (bars || []).map(closeOf).filter((x) => x > 0);
  if (closes.length < 35) return { closes, macd: [], signal: [] };
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const macd = closes.map((_, i) => fast[i] - slow[i]);
  const signal = ema(macd, 9);
  return { closes, macd, signal };
}

export function evaluateEquityCandidateV35(args = {}) {
  const cfg = { ...EQUITY_V35_DEFAULTS, ...(args.config || {}) };
  const asset = args.asset || {};
  const symbol = String(asset.symbol || '').toUpperCase();
  const bars = Array.isArray(args.bars) ? args.bars : [];
  const price = Number(args.snapshot?.latestTrade?.p ?? args.snapshot?.minuteBar?.c ?? closeOf(bars.at(-1)));

  if (!cfg.equityV35Enabled) return { signal: null, reason: 'EQUITY MACD: disabled', diagnostics: { score: 0 } };
  if (!symbol || !(price > 0)) return { signal: null, reason: 'EQUITY MACD: no tradable price', diagnostics: { score: 0 } };
  if (asset?.tradable === false) return { signal: null, reason: 'EQUITY MACD: asset not tradable', diagnostics: { score: 0 } };

  const { macd } = macdSeries(bars);
  const n = macd.length;
  const lookback = Math.max(50, Math.trunc(Number(cfg.equityMacdLookbackBars || 200)));
  if (n < lookback + 4) {
    return { signal: null, reason: `EQUITY MACD: need ${lookback + 4} bars`, diagnostics: { score: 0, bars: n } };
  }

  const i = n - 1;
  const troughIndex = i - 2;
  const prior = macd[troughIndex - 1];
  const trough = macd[troughIndex];
  const rise1 = macd[troughIndex + 1];
  const rise2 = macd[troughIndex + 2];

  const depthHistory = macd.slice(troughIndex - lookback, troughIndex).map((x) => Math.abs(Number(x)));
  const q = Math.max(0, Math.min(1, Number(cfg.equityMacdDepthQuantile ?? 0.50)));
  const requiredDepth = quantile(depthHistory, q);
  const depth = Math.abs(trough);

  const valley = trough < 0 && prior > trough;
  const twoRising = rise1 > trough && rise2 > rise1;
  const deepEnough = depth >= requiredDepth;

  if (!(valley && twoRising && deepEnough)) {
    return {
      signal: null,
      reason: `EQUITY MACD: waiting for below-zero valley + 2 rising bars + q${Math.round(q * 100)} depth`,
      diagnostics: { score: 0, valley, twoRising, deepEnough, trough, depth, requiredDepth },
    };
  }

  const depthRatio = requiredDepth > 0 ? depth / requiredDepth : 1;
  const reboundRatio = depth > 0 ? (rise2 - trough) / depth : 0;
  const score = Number(Math.max(6, Math.min(9.9, 6 + Math.min(2, depthRatio - 1) * 1.2 + Math.min(1.5, Math.max(0, reboundRatio)) * 1.2)).toFixed(2));

  return {
    signal: {
      symbol,
      name: asset?.name || symbol,
      assetClass: 'us_equity',
      direction: 'LONG',
      score,
      price,
      strategy: 'EQUITY_MACD_VALLEY_CROSS_PAPER',
      signal: {
        version: 'MACD_5M_PAPER',
        trigger: 'MACD_BELOW_ZERO_VALLEY_2_RISING_ADAPTIVE_DEPTH',
        timeframe: cfg.equityMacdTimeframe || '5Min',
        macd: { fast: 12, slow: 26, signal: 9 },
        exitPlan: {
          stopLossPct: 0,
          takeProfitPct: 0,
          trailTriggerPct: 0,
          trailDistancePct: 0,
          trailFloorPct: 0,
          maxHoldMinutes: 0,
          sizingRiskPct: Math.max(0.5, Number(cfg.equityMacdSizingRiskPct || 2)),
          maxPositionFraction: Math.max(0.01, Math.min(0.20, Number(cfg.equityMacdMaxPositionFraction || 0.15))),
          estimatedRoundTripCostPct: Math.max(0, Number(cfg.equityMacdEstimatedRoundTripCostPct || 0.04)),
          primaryExit: 'MACD_BEARISH_SIGNAL_CROSS_WHILE_MACD_ABOVE_ZERO',
        },
      },
    },
    reason: null,
    diagnostics: { score, trough, depth, requiredDepth, depthRatio, reboundRatio },
  };
}

export function evaluateEquityExitV35({ bars = [] } = {}) {
  const { macd, signal } = macdSeries(bars);
  const n = macd.length;
  if (n < 3) return { exit: false, reason: 'EQUITY MACD: not enough bars for exit' };

  const prev = n - 2;
  const curr = n - 1;
  const bearishCrossAboveZero =
    macd[prev] >= signal[prev] &&
    macd[curr] < signal[curr] &&
    macd[curr] > 0;

  return {
    exit: Boolean(bearishCrossAboveZero),
    reason: bearishCrossAboveZero
      ? 'EQUITY MACD bearish signal-line cross above zero'
      : 'EQUITY MACD exit not confirmed',
    diagnostics: { macdPrev: macd[prev], signalPrev: signal[prev], macd: macd[curr], signal: signal[curr] },
  };
}
