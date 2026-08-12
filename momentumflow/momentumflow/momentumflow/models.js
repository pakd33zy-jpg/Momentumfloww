// Legacy simulator / dashboard sample symbols only. The automated live bot dynamically loads Alpaca's supported tradable equities/ETFs + crypto universe.
import { v4 as uuid } from 'uuid';

export const MARKETS = {
  crypto: ['BTC', 'ETH', 'SOL'],
  equity: ['SPY', 'QQQ', 'GLD', 'GBTC'],
};

export const CONVICTION_MULTIPLIERS = {
  probe: 0.5,
  standard: 1.0,
  high: 1.25,
};

export function createSession({ mode, startingCapital }) {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    mode, // 'paper' | 'live'
    status: 'running', // 'running' | 'completed' | 'halted'
    starting_capital: startingCapital,
    ending_capital: startingCapital,
    total_pnl: 0,
    return_pct: 0,
    trades: 0,
    wins: 0,
    losses: 0,
    consecutive_losses: 0,
    win_rate: 0,
    profit_factor: 0,
    markets_traded: [],
    halt_reason: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
  };
}

export function createTrade({ sessionId, market, marketName, direction, conviction, entryPrice }) {
  const multiplier = CONVICTION_MULTIPLIERS[conviction] ?? 1.0;
  return {
    id: uuid(),
    session_id: sessionId,
    market,
    market_name: marketName,
    direction, // 'LONG' | 'SHORT'
    conviction, // 'probe' | 'standard' | 'high'
    multiplier,
    entry_price: entryPrice,
    exit_price: null,
    pnl: null,
    result: null, // 'win' | 'loss' | null (open)
    timestamp: new Date().toISOString(),
  };
}

export function recomputeSessionStats(session, trades) {
  const sessionTrades = trades.filter((t) => t.session_id === session.id && t.result !== null);
  const wins = sessionTrades.filter((t) => t.result === 'win').length;
  const losses = sessionTrades.filter((t) => t.result === 'loss').length;
  const grossWin = sessionTrades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(sessionTrades.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  const totalPnl = sessionTrades.reduce((s, t) => s + (t.pnl || 0), 0);
  const marketsTraded = [...new Set(sessionTrades.map((t) => t.market))];

  session.trades = sessionTrades.length;
  session.wins = wins;
  session.losses = losses;
  session.win_rate = sessionTrades.length ? Number(((wins / sessionTrades.length) * 100).toFixed(2)) : 0;
  session.profit_factor = grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? Infinity : 0;
  session.total_pnl = Number(totalPnl.toFixed(2));
  session.ending_capital = Number((session.starting_capital + totalPnl).toFixed(2));
  session.return_pct = Number(((totalPnl / session.starting_capital) * 100).toFixed(2));
  session.markets_traded = marketsTraded;
  session.updated_at = new Date().toISOString();
  return session;
}
