/**
 * Preflight broker inventory before a position-closing order.
 * A stale bot trade record must never turn a sell into an unapproved short.
 * Pure: no broker calls, writes, or execution.
 */
function normalize(symbol) {
  const s = String(symbol || '').trim().toUpperCase().replace(/\s/g, '');
  return s.includes('/') ? s.replace('/', '') : s;
}
export function planBrokerExit({ symbol, direction, recordedQty, positions }) {
  const qty = Number(recordedQty);
  if (!(qty > 0) || !Number.isFinite(qty)) {
    return { allowed: false, reason: 'invalid-recorded-quantity' };
  }
  if (!Array.isArray(positions)) {
    return { allowed: false, reason: 'broker-inventory-unavailable' };
  }
  const matches = positions.filter(p => normalize(p?.symbol) === normalize(symbol));
  if (matches.length !== 1) {
    return { allowed: false, reason: matches.length ? 'ambiguous-broker-inventory' : 'broker-position-missing' };
  }
  const p = matches[0];
  const signed = Number(p.qty);
  if (!Number.isFinite(signed) || signed === 0) {
    return { allowed: false, reason: 'zero-or-invalid-broker-position' };
  }
  if (direction === 'LONG') {
    if (signed <= 0) return { allowed: false, reason: 'broker-position-not-long' };
    const available = Number(p.qty_available ?? p.qty);
    if (!Number.isFinite(available) || !(available > 0)) {
      return { allowed: false, reason: 'no-broker-sellable-inventory' };
    }
    // Large differences mean broker and bot disagree; don't misstate PnL.
    if (Math.min(available, signed) / qty < 0.99) {
      return { allowed: false, reason: 'broker-position-quantity-mismatch' };
    }
    return { allowed: true, side: 'sell', qty: Math.min(qty, available, signed) };
  }
  if (direction === 'SHORT') {
    if (signed >= 0) return { allowed: false, reason: 'broker-position-not-short' };
    if (Math.abs(signed) / qty < 0.99) {
      return { allowed: false, reason: 'broker-position-quantity-mismatch' };
    }
    return { allowed: true, side: 'buy', qty: Math.min(qty, Math.abs(signed)) };
  }
  return { allowed: false, reason: 'unsupported-trade-direction' };
}
