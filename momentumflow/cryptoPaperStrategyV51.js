import { CRYPTO_V51_SHADOW_DEFAULTS, deriveCryptoV51State } from './cryptoForwardLearningV51.js';

export const CRYPTO_V51_PAPER_DEFAULTS = Object.freeze({
  ...CRYPTO_V51_SHADOW_DEFAULTS,
  minimumOpportunityScore: 0.56,
  maxConcurrentPositions: 8,
  riskFraction: 0.01,
  maxPositionFractionOfEquity: 0.12,
  maxTotalCryptoExposureFraction: 0.70,
  maxOpenRiskFraction: 0.08,
  estimatedRoundTripCostPct: 0.10,
  maxHoldMinutes: 60,
});

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, Number(x) || 0));

export function evaluateCryptoCandidateV51({ asset, snapshot, v35Result, config = {} } = {}) {
  const cfg = { ...CRYPTO_V51_PAPER_DEFAULTS, ...config };
  const symbol = String(asset?.symbol || '').toUpperCase();
  const price = Number(snapshot?.latestTrade?.p ?? snapshot?.minuteBar?.c ?? 0);
  if (!symbol || !(price > 0)) return { signal: null, reason: 'V51: no tradable price', diagnostics: { score: 0 } };

  const state = deriveCryptoV51State(v35Result || {});
  const threshold = Number(cfg.minimumOpportunityScore || 0.56);
  if (state.opportunityScore < threshold) {
    return {
      signal: null,
      reason: `V51: opportunity ${state.opportunityScore.toFixed(4)} below ${threshold.toFixed(4)}`,
      diagnostics: { score: Number((state.opportunityScore * 10).toFixed(2)), state },
    };
  }

  const atrPct = Math.max(0, Number(state.context?.atrPct || 0));
  const stopLossPct = clamp(atrPct > 0 ? atrPct * 1.25 : 1.25, 0.75, 3.0);
  const takeProfitPct = clamp(stopLossPct * 1.8, 1.25, 5.0);
  const score = Number((state.opportunityScore * 10).toFixed(2));

  return {
    signal: {
      symbol,
      name: asset?.name || symbol,
      assetClass: 'crypto',
      direction: 'LONG',
      strategy: 'CRYPTO_V51_PAPER_FORWARD',
      score,
      price,
      signal: {
        trigger: 'V51_FORWARD_OPPORTUNITY',
        v51State: state,
        exitPlan: {
          stopLossPct: Number(stopLossPct.toFixed(4)),
          takeProfitPct: Number(takeProfitPct.toFixed(4)),
          trailTriggerPct: Number((stopLossPct * 1.0).toFixed(4)),
          trailDistancePct: Number((stopLossPct * 0.65).toFixed(4)),
          trailFloorPct: Number((stopLossPct * 0.25).toFixed(4)),
          maxHoldMinutes: Math.max(15, Number(cfg.maxHoldMinutes || 60)),
          estimatedRoundTripCostPct: Math.max(0, Number(cfg.estimatedRoundTripCostPct || 0.10)),
        },
      },
    },
    reason: null,
    diagnostics: { score, state },
  };
}

export function buildCryptoV51Budget({ equity, cash, currentCryptoExposure = 0, currentOpenRiskDollars = 0, signal, config = {} } = {}) {
  const cfg = { ...CRYPTO_V51_PAPER_DEFAULTS, ...config };
  const e = Math.max(0, Number(equity || 0));
  const c = Math.max(0, Number(cash || 0));
  if (!(e > 0) || !(c > 0)) return 0;

  const riskFraction = clamp(cfg.riskFraction, 0.001, 0.02);
  const maxPositionFraction = clamp(cfg.maxPositionFractionOfEquity, 0.01, 0.25);
  const maxExposureFraction = clamp(cfg.maxTotalCryptoExposureFraction, 0.10, 0.95);
  const maxRiskFraction = clamp(cfg.maxOpenRiskFraction, 0.01, 0.15);
  const stopPct = Math.max(0.25, Number(signal?.signal?.exitPlan?.stopLossPct || 1.25));
  const costPct = Math.max(0, Number(signal?.signal?.exitPlan?.estimatedRoundTripCostPct || 0.10));

  const riskRoom = Math.max(0, e * maxRiskFraction - Math.max(0, Number(currentOpenRiskDollars || 0)));
  const desiredRisk = Math.min(e * riskFraction, riskRoom);
  if (!(desiredRisk > 0)) return 0;

  const riskSized = desiredRisk / ((stopPct + costPct) / 100);
  const exposureRoom = Math.max(0, e * maxExposureFraction - Math.max(0, Number(currentCryptoExposure || 0)));
  return Math.max(0, Math.min(riskSized, e * maxPositionFraction, exposureRoom, c * 0.90));
}
