// Preflight for a LONG cryptocurrency exit on Alpaca.
// Never infer that an untracked or unavailable balance is sellable: that
// would risk an unintentional short order or repeated broker rejections.
const comparable = (symbol = '') => String(symbol).toUpperCase().replaceAll('/', '').trim();

export function cryptoExitSellPreflight({ market, requestedQty, positions = [] } = {}) {
  const requested = Number(requestedQty);
  if (!market || !Number.isFinite(requested) || requested <= 0) {
    return { allowed: false, reason: 'invalid-crypto-exit-request' };
  }
  if (!Array.isArray(positions)) {
    return { allowed: false, reason: 'positions-unavailable' };
  }
  const matching = positions.filter((p) => comparable(p?.symbol) === comparable(market));
  if (matching.length !== 1) {
    return { allowed: false, reason: matching.length ? 'ambiguous-broker-position' : 'no-broker-position' };
  }
  const p = matching[0];
  const held = Number(p.qty);
  const available = Number(p.qty_available ?? p.qty);
  if (!Number.isFinite(held) || held <= 0) {
    return { allowed: false, reason: 'non-long-broker-position' };
  }
  if (!Number.isFinite(available) || available <= 0) {
    return { allowed: false, reason: 'no-available-crypto-to-sell' };
  }
  const sellQty = Math.min(requested, held, available);
  // Format to at most 9 decimals, always rounding DOWN so a sell never
  // exceeds the broker's available balance.
  const truncated = Math.floor(sellQty * 1e9) / 1e9;
  if (!(truncated > 0)) {
    return { allowed: false, reason: 'below-supported-crypto-precision' };
  }
  const qty = truncated.toFixed(9).replace(/0+$/, '').replace(/\.$/, '');
  return { allowed: true, qty, requestedQty: requested, brokerHeldQty: held, brokerAvailableQty: available };
}
