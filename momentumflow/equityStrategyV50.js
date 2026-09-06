// EQUITY STRATEGY V50 — adaptive, market-neutral ETF relative strength.
// Validated for paper-forward use only. Never bypass the live-trading gate.

export const EQUITY_V50_DEFAULTS = Object.freeze({
  symbols: ['SPY', 'QQQ', 'IWM', 'DIA', 'XLK', 'XLF', 'XLE', 'GLD', 'TLT'],
  lookbackBars: 12,
  holdMinutes: 120,
  minimumDispersionPct: 0.50,
  expertReviewTrades: 6,
  minimumExpertEdgePct: 0.075,
  estimatedRoundTripCostPct: 0.06,
  grossLegFraction: 0.50,
  maxPairRiskFraction: 0.003,
});

const close = (bar) => Number(bar?.c ?? bar?.close ?? 0);
const open = (bar) => Number(bar?.o ?? bar?.open ?? 0);
const mean = (rows) => rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : 0;

export function chooseV50Playbook(history = {}, config = {}) {
  const cfg = { ...EQUITY_V50_DEFAULTS, ...config };
  const momentum = (history.momentum || []).slice(-cfg.expertReviewTrades).map(Number).filter(Number.isFinite);
  const reversion = (history.reversion || []).slice(-cfg.expertReviewTrades).map(Number).filter(Number.isFinite);
  if (momentum.length < cfg.expertReviewTrades || reversion.length < cfg.expertReviewTrades) {
    return { playbook: 'SHADOW_ONLY', reason: 'V50 expert warmup incomplete', momentumEdgePct: null, reversionEdgePct: null };
  }
  const momentumEdgePct = mean(momentum);
  const reversionEdgePct = mean(reversion);
  const best = Math.max(momentumEdgePct, reversionEdgePct);
  if (best <= cfg.minimumExpertEdgePct) {
    return { playbook: 'CASH', reason: 'V50 no positive recent expert edge', momentumEdgePct, reversionEdgePct };
  }
  return {
    playbook: momentumEdgePct > reversionEdgePct ? 'MOMENTUM' : 'REVERSION',
    reason: null,
    momentumEdgePct,
    reversionEdgePct,
  };
}

export function evaluateEquityBasketV50({ barsBySymbol = {}, assetsBySymbol = {}, expertHistory = {}, config = {} } = {}) {
  const cfg = { ...EQUITY_V50_DEFAULTS, ...config };
  const returns = [];
  for (const symbol of cfg.symbols) {
    const bars = (barsBySymbol[symbol] || []).filter((bar) => close(bar) > 0);
    if (bars.length <= cfg.lookbackBars) continue;
    const latest = close(bars.at(-1));
    const prior = close(bars.at(-(cfg.lookbackBars + 1)));
    if (prior > 0) returns.push({ symbol, returnPct: (latest / prior - 1) * 100, price: latest });
  }
  if (returns.length < cfg.symbols.length) {
    return { signal: null, reason: `V50 incomplete synchronized universe (${returns.length}/${cfg.symbols.length})` };
  }
  returns.sort((a, b) => b.returnPct - a.returnPct);
  const strongest = returns[0];
  const weakest = returns.at(-1);
  const dispersionPct = strongest.returnPct - weakest.returnPct;
  if (dispersionPct < cfg.minimumDispersionPct) {
    return { signal: null, reason: 'V50 cross-market dispersion below threshold', diagnostics: { dispersionPct } };
  }
  const selected = chooseV50Playbook(expertHistory, cfg);
  if (selected.playbook === 'SHADOW_ONLY' || selected.playbook === 'CASH') {
    return { signal: null, reason: selected.reason, diagnostics: { ...selected, dispersionPct, strongest, weakest } };
  }
  const longLeg = selected.playbook === 'MOMENTUM' ? strongest : weakest;
  const shortLeg = selected.playbook === 'MOMENTUM' ? weakest : strongest;
  const shortAsset = assetsBySymbol[shortLeg.symbol] || {};
  if (shortAsset.shortable !== true || !(shortAsset.easy_to_borrow === true || shortAsset.easyToBorrow === true)) {
    return { signal: null, reason: `V50 short leg unavailable: ${shortLeg.symbol}`, diagnostics: { ...selected, dispersionPct } };
  }
  return {
    signal: {
      strategy: 'EQUITY_V50_ADAPTIVE_PAIR',
      version: 'V50',
      playbook: selected.playbook,
      score: Number(Math.min(10, 5 + dispersionPct * 2).toFixed(2)),
      legs: [
        { symbol: longLeg.symbol, direction: 'LONG', price: longLeg.price, grossFraction: cfg.grossLegFraction },
        { symbol: shortLeg.symbol, direction: 'SHORT', price: shortLeg.price, grossFraction: cfg.grossLegFraction },
      ],
      exitPlan: { maxHoldMinutes: cfg.holdMinutes, estimatedRoundTripCostPct: cfg.estimatedRoundTripCostPct },
      diagnostics: { ...selected, dispersionPct, strongest, weakest },
    },
    reason: null,
  };
}

export function settleV50ShadowObservation(observation = {}, config = {}) {
  const cfg = { ...EQUITY_V50_DEFAULTS, ...config };
  const highEntry = Number(observation.highEntry);
  const highExit = Number(observation.highExit);
  const lowEntry = Number(observation.lowEntry);
  const lowExit = Number(observation.lowExit);
  if (![highEntry, highExit, lowEntry, lowExit].every((x) => x > 0)) throw new Error('V50 invalid shadow observation prices');
  const spreadPct = ((highExit / highEntry - 1) - (lowExit / lowEntry - 1)) * 50;
  return {
    momentum: Number((spreadPct - cfg.estimatedRoundTripCostPct).toFixed(6)),
    reversion: Number((-spreadPct - cfg.estimatedRoundTripCostPct).toFixed(6)),
  };
}
