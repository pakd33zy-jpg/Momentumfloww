/**
 * Alpaca supports selling owned crypto only, never opening short crypto positions.
 * A persisted trade quantity is not authoritative after partial exits, manual
 * trades, open sell orders, or broker-side adjustments.
 */
function normalize(symbol) {
  const value = String(symbol || '').toUpperCase().replace('/', '');
  return value;
}

export function safeCryptoSellQuantity({ symbol, trackedQty, brokerPositions = [] } = {}) {
  const tracked = Number(trackedQty);
  if (!Number.isFinite(tracked) || tracked <= 0) {
    return { allowed: false, reason: 'invalid-tracked-qty', qty: 0 };
  }
  const position = Array.isArray(brokerPositions)
    ? brokerPositions.find((p) => normalize(p?.symbol) === normalize(symbol))
    : null;
  if (!position) return { allowed: false, reason: 'no-broker-position', qty: 0 };

  const held = Number(position.qty);
  // qty_available can be 0 when holdings are already reserved for an open sell.
  // An explicit zero must NOT fall back to qty.
  const free = position.qty_available == null ? held : Number(position.qty_available);
  if (!Number.isFinite(held) || held <= 0) {
    return { allowed: false, reason: 'no-positive-holdings', qty: 0 };
  }
  if (!Number.isFinite(free) || free <= 0) {
    return { allowed: false, reason: 'no-available-holdings', qty: 0 };
  }
  const qty = Math.min(tracked, held, free);
  if (!(qty > 0)) return { allowed: false, reason: 'no-sellable-quantity', qty: 0 };
  return { allowed: true, reason: null, qty };
}
