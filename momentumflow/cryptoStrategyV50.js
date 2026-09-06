// CRYPTO STRATEGY V50 — 24/7 long/cash spot adaptation.
// Builds on V35's validated risk model and adds explicit price-action confirmation.
import { CRYPTO_V35_DEFAULTS, buildCryptoV35Budget, evaluateCryptoCandidateV35 } from './cryptoStrategyV35.js';

export const CRYPTO_V50_DEFAULTS = Object.freeze({
  ...CRYPTO_V35_DEFAULTS,
  cryptoV35MinScore: 5.6,
  cryptoV50StrongScore: 7.4,
  cryptoV50PatternLookback: 8,
});

const n = (value) => Number(value);
const open = (bar) => n(bar?.o ?? bar?.open);
const close = (bar) => n(bar?.c ?? bar?.close);
const high = (bar) => n(bar?.h ?? bar?.high);
const low = (bar) => n(bar?.l ?? bar?.low);

export function cryptoV50PriceAction(bars = [], config = {}) {
  const cfg = { ...CRYPTO_V50_DEFAULTS, ...config };
  const rows = bars.filter((bar) => close(bar) > 0 && high(bar) > 0 && low(bar) > 0);
  if (rows.length < cfg.cryptoV50PatternLookback + 2) return { confirmed: false, patterns: [], reason: 'V50 crypto price-action warmup' };
  const current = rows.at(-1);
  const previous = rows.at(-2);
  const context = rows.slice(-(cfg.cryptoV50PatternLookback + 1), -1);
  const priorHigh = Math.max(...context.map(high));
  const priorLow = Math.min(...context.map(low));
  const bullishEngulfing = close(current) > open(current) && close(previous) < open(previous)
    && open(current) <= close(previous) && close(current) >= open(previous);
  const highBreak = close(current) > priorHigh && close(previous) <= priorHigh;
  const lowSweepReclaim = low(current) < priorLow && close(current) > priorLow && close(current) > open(current);
  const levelFlip = low(current) <= priorHigh && close(current) > priorHigh;
  const patterns = [
    bullishEngulfing && 'BULLISH_ENGULFING',
    highBreak && 'HIGH_BREAK',
    lowSweepReclaim && 'LOW_SWEEP_RECLAIM',
    levelFlip && 'LEVEL_FLIP',
  ].filter(Boolean);
  return { confirmed: patterns.length > 0, patterns, priorHigh, priorLow };
}

export function evaluateCryptoCandidateV50(input = {}) {
  const cfg = { ...CRYPTO_V50_DEFAULTS, ...(input.config || {}) };
  const base = evaluateCryptoCandidateV35({ ...input, config: cfg });
  if (!base.signal) return base;
  const priceAction = cryptoV50PriceAction(input.bars15m || [], cfg);
  const strongEvidence = Number(base.signal.score) >= cfg.cryptoV50StrongScore;
  if (!priceAction.confirmed && !strongEvidence) {
    return {
      signal: null,
      reason: 'V50: crypto entry lacks price-action confirmation',
      diagnostics: { ...(base.diagnostics || {}), priceAction, baseScore: base.signal.score },
    };
  }
  return {
    ...base,
    signal: {
      ...base.signal,
      strategy: 'CRYPTO_V50_ADAPTIVE',
      version: 'V50',
      evidence: [...(base.signal.evidence || []), ...(priceAction.patterns || [])],
      diagnostics: { ...(base.signal.diagnostics || {}), priceAction, strongEvidence },
    },
  };
}

export { buildCryptoV35Budget as buildCryptoV50Budget };
