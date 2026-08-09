/**
 * Central safety rules. Every one of these is enforced server-side — the frontend
 * may also show these limits in the UI, but the server never trusts the client's
 * judgment about whether a trade or session is allowed to proceed.
 */
export const SAFETY_RULES = {
  DAILY_LOSS_HALT_PCT: 10, // auto-halt if session drawdown hits -10% of starting capital
  CONSECUTIVE_LOSS_HALT: 3, // auto-halt after 3 consecutive losing trades
  MAX_TRADES_PER_MARKET: 12, // per session, per market
  MAX_TRADES_PER_SESSION: 24,
};

/**
 * Checks whether a session should be halted given its current stats.
 * Returns { halt: boolean, reason: string|null }
 */
export function checkHaltConditions(session) {
  const drawdownPct = ((session.starting_capital - session.ending_capital) / session.starting_capital) * 100;

  if (drawdownPct >= SAFETY_RULES.DAILY_LOSS_HALT_PCT) {
    return { halt: true, reason: `Daily loss cap hit: -${drawdownPct.toFixed(1)}% (limit ${SAFETY_RULES.DAILY_LOSS_HALT_PCT}%)` };
  }
  if (session.consecutive_losses >= SAFETY_RULES.CONSECUTIVE_LOSS_HALT) {
    return { halt: true, reason: `${SAFETY_RULES.CONSECUTIVE_LOSS_HALT} consecutive losses` };
  }
  if (session.trades >= SAFETY_RULES.MAX_TRADES_PER_SESSION) {
    return { halt: true, reason: `Session trade cap reached (${SAFETY_RULES.MAX_TRADES_PER_SESSION})` };
  }
  return { halt: false, reason: null };
}

/** Checks whether a new trade in `market` is allowed given trades already taken this session. */
export function canTradeMarket(sessionTrades, market) {
  const marketCount = sessionTrades.filter((t) => t.market === market).length;
  return marketCount < SAFETY_RULES.MAX_TRADES_PER_MARKET;
}

const REQUIRED_LIVE_GATE_ITEMS = [
  'understands_real_capital',
  'reviewed_strategy_backtest',
  'alpaca_live_key_configured',
  'accepts_safety_halts',
  'confirms_risk_tolerance',
];

/**
 * The hard gate for live trading. ALL of the following must be true:
 *  1. Every one of the 5 Live Gate checklist items has been explicitly consented to
 *  2. The server was started with LIVE_TRADING_ENABLED=true
 *  3. Encrypted Alpaca live credentials exist
 * This function is the single choke point — every route that could place a live
 * order must call this and refuse to proceed unless it returns { allowed: true }.
 */
export function evaluateLiveGate({ consents, hasLiveCredentials }) {
  const missing = REQUIRED_LIVE_GATE_ITEMS.filter((key) => !consents?.[key]);
  const envEnabled = String(process.env.LIVE_TRADING_ENABLED).toLowerCase() === 'true';

  if (missing.length > 0) {
    return { allowed: false, reason: `Live Gate incomplete: missing consent for ${missing.join(', ')}` };
  }
  if (!envEnabled) {
    return { allowed: false, reason: 'LIVE_TRADING_ENABLED is not set to true on the server. This is a deliberate operator-level override.' };
  }
  if (!hasLiveCredentials) {
    return { allowed: false, reason: 'No Alpaca live credentials on file.' };
  }
  return { allowed: true, reason: null };
}

export { REQUIRED_LIVE_GATE_ITEMS };
