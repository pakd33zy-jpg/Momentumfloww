export function voidOpenPaperTradesAfterAccountReset(
  trades,
  sessions,
  now = new Date().toISOString()
) {
  const sessionById = new Map(
    sessions.map((session) => [session.id, session])
  );

  const voidedTradeIds = [];
  const affectedSessionIds = new Set();

  const updatedTrades = trades.map((trade) => {
    const session = sessionById.get(trade.session_id);

    if (
      trade.result !== null ||
      trade.voided === true ||
      session?.mode !== 'paper'
    ) {
      return trade;
    }

    voidedTradeIds.push(trade.id);
    affectedSessionIds.add(trade.session_id);

    return {
      ...trade,
      result: 'void',
      pnl: 0,
      gross_pnl: 0,
      exit_price: trade.entry_price,
      exit_qty: 0,
      exit_order_id: null,
      exit_order_ids: [],
      exit_reason: 'paper account reset; broker position no longer exists',
      voided: true,
      account_reset_reconciled: true,
      pending_exit_reason: null,
      pending_exit_started_at: null,
      closed_at: now,
    };
  });

  return {
    trades: updatedTrades,
    voidedTradeIds,
    affectedSessionIds: [...affectedSessionIds],
  };
}
