// CRYPTO STRATEGY V35 — crypto-specific, evidence-weighted LONG/cash model.
// V34 is preserved as the baseline. V35 keeps only data/execution/economic
// impossibility as hard blockers and turns market context into weighted evidence.

import {
  CRYPTO_V34_DEFAULTS,
  evaluateCryptoCandidateV34,
} from './cryptoStrategyV34.js';

export const CRYPTO_V35_DEFAULTS = {
  ...CRYPTO_V34_DEFAULTS,
  cryptoV35Enabled: true,
  cryptoV35MinScore: 5.5,
  cryptoV35RiskFraction: 0.01,
  cryptoV35MaxPortfolioRiskFraction: 0.05,
  cryptoV35MaxPositionFraction: 0.20,
  cryptoV35MaxTotalExposureFraction: 0.80,
  cryptoV35MaxConcurrentPositions: 8,
};

const n = (v, fallback = NaN) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const close = (bar) => n(bar?.c ?? bar?.close);

function validBars(bars = []) {
  return (bars || []).filter((bar) => close(bar) > 0);
}

function retPct(bars = [], lookback = 1) {
  const rows = validBars(bars);
  if (rows.length <= lookback) return null;
  const last = close(rows.at(-1));
  const prior = close(rows.at(-(lookback + 1)));
  return prior > 0 ? (last / prior - 1) * 100 : null;
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
  const c = { ...CRYPTO_V35_DEFAULTS, ...config };
  const symbol = String(asset?.symbol || '').toUpperCase();

  // Let V34 calculate its detailed technical/execution evidence, but do not let
  // the old score threshold become an early kill switch. V35 owns qualification.
  const base = evaluateCryptoCandidateV34({
    asset,
    snapshot,
    bars15m,
    bars1h,
    bars1d,
    intelligence,
    config: {
      ...c,
      cryptoV34MinScore: 0,
      cryptoV34Symbols: [...new Set([...(c.cryptoV34Symbols || []), symbol])],
    },
  });

  if (!base?.signal) {
    return {
      ...base,
      reason: base?.diagnostics?.reason || 'V35: base crypto evidence unavailable',
    };
  }

  const metrics = base?.diagnostics?.metrics || base?.signal?.signal || {};
  const asset24h = n(metrics?.ret24hPct, 0);
  const asset6h = n(metrics?.ret6hPct, 0);
  const btc24h = n(retPct(btcBars1h, 24), 0);
  const btc6h = n(retPct(btcBars1h, 6), 0);
  const relative24h = asset24h - btc24h;
  const relative6h = asset6h - btc6h;

  let contextScore = 0;
  if (btc24h > 1) contextScore += 0.35;
  else if (btc24h > 0) contextScore += 0.15;
  else if (btc24h < -2) contextScore -= 0.45;
  else if (btc24h < 0) contextScore -= 0.15;

  if (relative24h > 2) contextScore += 0.55;
  else if (relative24h > 0.5) contextScore += 0.30;
  else if (relative24h < -2) contextScore -= 0.55;
  else if (relative24h < -0.5) contextScore -= 0.25;

  if (relative6h > 0.5) contextScore += 0.20;
  else if (relative6h < -0.75) contextScore -= 0.20;

  const baseScore = n(base.signal.score, 0);
  const score = Number(clamp(baseScore + contextScore, 0, 10).toFixed(2));
  const threshold = n(c.cryptoV35MinScore, 5.5);

  const evidence = [
    ...(base.signal?.signal?.intelligenceReasons || []),
    `BTC 24h ${btc24h.toFixed(3)}% / 6h ${btc6h.toFixed(3)}%`,
    `relative 24h ${relative24h.toFixed(3)}% / 6h ${relative6h.toFixed(3)}%`,
  ];

  if (score < threshold) {
    return {
      signal: null,
      diagnostics: {
        ...(base.diagnostics || {}),
        eligible: false,
        hardReject: false,
        reason: 'V35: combined crypto evidence below threshold',
        score,
        threshold,
        metrics: {
          ...metrics,
          baseScore,
          contextScore,
          btc24hPct: btc24h,
          btc6hPct: btc6h,
          relative24hPct: relative24h,
          relative6hPct: relative6h,
          evidence,
        },
      },
      reason: 'V35: combined crypto evidence below threshold',
    };
  }

  return {
    ...base,
    signal: {
      ...base.signal,
      score,
      strategy: 'CRYPTO_V35_EVIDENCE',
      signal: {
        ...(base.signal.signal || {}),
        version: 'V35',
        baseScore,
        contextScore,
        btc24hPct: btc24h,
        btc6hPct: btc6h,
        relative24hPct: relative24h,
        relative6hPct: relative6h,
        evidence,
      },
    },
    diagnostics: {
      ...(base.diagnostics || {}),
      eligible: true,
      score,
      threshold,
      metrics: {
        ...metrics,
        baseScore,
        contextScore,
        btc24hPct: btc24h,
        btc6hPct: btc6h,
        relative24hPct: relative24h,
        relative6hPct: relative6h,
        evidence,
      },
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
  const c = { ...CRYPTO_V35_DEFAULTS, ...config };
  const stopPct = n(signal?.signal?.exitPlan?.stopLossPct);
  if (!(equity > 0) || !(cash > 0) || !(stopPct > 0)) return 0;

  const requestedRiskDollars = equity * n(c.cryptoV35RiskFraction, 0.01);
  const portfolioRiskRoom = Math.max(
    0,
    equity * n(c.cryptoV35MaxPortfolioRiskFraction, 0.05) - Math.max(0, currentOpenRiskDollars),
  );
  const usableRiskDollars = Math.min(requestedRiskDollars, portfolioRiskRoom);
  if (!(usableRiskDollars > 0)) return 0;

  const costPct = Math.max(0, n(signal?.signal?.exitPlan?.estimatedRoundTripCostPct, 0.50));
  const riskSizedNotional = usableRiskDollars / ((stopPct + costPct) / 100);
  const symbolCap = equity * n(c.cryptoV35MaxPositionFraction, 0.20);
  const exposureRoom = Math.max(
    0,
    equity * n(c.cryptoV35MaxTotalExposureFraction, 0.80) - Math.max(0, currentCryptoExposure),
  );

  return Math.max(0, Math.min(riskSizedNotional, symbolCap, exposureRoom, cash * 0.95));
}
