/**
 * Shared pre-trade risk gate for all independent MomentumFlow engines.
 * Pure functions only: no broker calls, persistence, or order placement.
 * Every engine must pass through this gate before it can request an execution.
 */
const finitePositive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

export const DEFAULT_SHARED_RISK_LIMITS = Object.freeze({
  maxRiskPerTradePct: 0.005,
  maxDailyLossPct: 0.02,
  maxOpenPositions: 4,
  maxGrossExposurePct: 0.50,
  maxPositionNotionalPct: 0.15,
  allowShort: false,
});

export function sizePosition({ equity, entryPrice, stopPrice, riskPct = 0.005, maxPositionNotionalPct = 0.15 }) {
  if (![equity, entryPrice, stopPrice, riskPct, maxPositionNotionalPct].every((v) => Number.isFinite(Number(v)))) {
    throw new Error('Position sizing inputs must be finite numbers.');
  }
  const e = Number(equity), entry = Number(entryPrice), stop = Number(stopPrice);
  const risk = Number(riskPct), cap = Number(maxPositionNotionalPct);
  if (!finitePositive(e) || !finitePositive(entry) || !finitePositive(stop) || stop >= entry) {
    throw new Error('Long position sizing requires positive equity/prices and a stop below entry.');
  }
  if (risk <= 0 || risk > 0.02 || cap <= 0 || cap > 1) {
    throw new Error('Risk and notional caps are outside permitted bounds.');
  }
  const riskBudget = e * risk;
  const perUnitRisk = entry - stop;
  const riskQty = riskBudget / perUnitRisk;
  const notionalQty = (e * cap) / entry;
  const quantity = Math.floor(Math.min(riskQty, notionalQty) * 1e8) / 1e8;
  return { quantity, riskBudget, estimatedRisk: quantity * perUnitRisk, notional: quantity * entry };
}

export function evaluateOrderRisk(order, account, limits = {}) {
  const cfg = { ...DEFAULT_SHARED_RISK_LIMITS, ...limits };
  const equity = Number(account?.equity);
  const dailyPnl = Number(account?.dailyPnl || 0);
  const openPositions = Array.isArray(account?.openPositions) ? account.openPositions : [];
  const grossExposure = openPositions.reduce((sum, p) => sum + Math.abs(Number(p.notional || 0)), 0);
  const symbol = String(order?.symbol || '').trim().toUpperCase();
  const side = String(order?.side || '').trim().toLowerCase();
  const quantity = Number(order?.quantity);
  const entryPrice = Number(order?.entryPrice);
  const stopPrice = Number(order?.stopPrice);
  const reasons = [];

  if (order?.mode !== 'paper') reasons.push('Shared risk gate currently permits paper mode only.');
  if (!finitePositive(equity)) reasons.push('Account equity is missing or invalid.');
  if (!symbol) reasons.push('Order symbol is required.');
  if (!['buy', 'sell'].includes(side)) reasons.push('Order side must be buy or sell.');
  if (side === 'sell' && !cfg.allowShort) reasons.push('Short entries are disabled by shared risk policy.');
  if (!finitePositive(quantity) || !finitePositive(entryPrice) || !finitePositive(stopPrice)) {
    reasons.push('Quantity, entry price, and stop price must be positive.');
  } else if (side === 'buy' && stopPrice >= entryPrice) {
    reasons.push('Long stop must be below entry.');
  } else if (side === 'sell' && stopPrice <= entryPrice) {
    reasons.push('Short stop must be above entry.');
  }
  if (finitePositive(equity) && dailyPnl <= -(equity * Number(cfg.maxDailyLossPct))) {
    reasons.push('Daily loss limit reached; new entries are halted.');
  }
  if (openPositions.length >= Number(cfg.maxOpenPositions)) reasons.push('Maximum open-position count reached.');
  if (symbol && openPositions.some((p) => String(p.symbol || '').toUpperCase() === symbol)) {
    reasons.push('An open position already exists for this symbol.');
  }

  if (finitePositive(equity) && finitePositive(quantity) && finitePositive(entryPrice) && finitePositive(stopPrice)) {
    const perUnitRisk = Math.abs(entryPrice - stopPrice);
    const proposedRisk = perUnitRisk * quantity;
    const proposedNotional = entryPrice * quantity;
    if (proposedRisk > equity * Number(cfg.maxRiskPerTradePct)) reasons.push('Proposed trade exceeds the per-trade risk cap.');
    if (proposedNotional > equity * Number(cfg.maxPositionNotionalPct)) reasons.push('Proposed position exceeds the single-position notional cap.');
    if (grossExposure + proposedNotional > equity * Number(cfg.maxGrossExposurePct)) reasons.push('Proposed trade exceeds the gross-exposure cap.');
  }

  return { allowed: reasons.length === 0, reasons, policy: cfg };
}
