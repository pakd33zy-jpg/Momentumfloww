import { store } from './store.js';

// SAFETY ENGINE v16
//
// Uses the saved trading configuration.
// PAPER and LIVE use the same safety limits.

const FALLBACKS = {
  dailyLossLimit: 0.10,
  consecutiveStopLoss: 3,
  maxTradesPerMarket: 12,
  maxTradesPerSession: 24,
};

function limits() {
  const c =
    store.getConfig(
      'tradingConfig',
      FALLBACKS
    );

  return {
    dailyLossLimit:
      Number(
        c.dailyLossLimit ??
        FALLBACKS.dailyLossLimit
      ),

    consecutiveStopLoss:
      Number(
        c.consecutiveStopLoss ??
        FALLBACKS.consecutiveStopLoss
      ),

    maxTradesPerMarket:
      Number(
        c.maxTradesPerMarket ??
        c.tradesPerMarket ??
        FALLBACKS.maxTradesPerMarket
      ),

    maxTradesPerSession:
      Number(
        c.maxTradesPerSession ??
        c.tradesPerSession ??
        FALLBACKS.maxTradesPerSession
      ),
  };
}

export function checkHaltConditions(
  session
) {
  const c =
    limits();

  const starting =
    Number(
      session.starting_capital ||
      0
    );

  const ending =
    Number(
      session.ending_capital ??
      session.current_capital ??
      starting
    );

  const drawdownFraction =
    starting > 0
      ? (
          starting -
          ending
        ) /
        starting
      : 0;

  if (
    drawdownFraction >=
    c.dailyLossLimit
  ) {
    return {
      halt: true,

      reason:
        `Daily loss cap hit: -${(
          drawdownFraction *
          100
        ).toFixed(1)}% ` +
        `(limit ${(
          c.dailyLossLimit *
          100
        ).toFixed(1)}%)`,
    };
  }

  if (
    Number(
      session.consecutive_losses ||
      0
    ) >=
    c.consecutiveStopLoss
  ) {
    return {
      halt: true,

      reason:
        `${c.consecutiveStopLoss} consecutive losses`,
    };
  }

  if (
    Number(
      session.trades ||
      0
    ) >=
    c.maxTradesPerSession
  ) {
    return {
      halt: true,

      reason:
        `Session trade cap reached (${c.maxTradesPerSession})`,
    };
  }

  return {
    halt: false,
    reason: null,
  };
}

export function canTradeMarket(
  sessionTrades,
  market
) {
  const c =
    limits();

  const marketCount =
    (
      sessionTrades ||
      []
    ).filter(
      (trade) =>
        trade.market ===
        market
    ).length;

  return (
    marketCount <
    c.maxTradesPerMarket
  );
}

export const REQUIRED_LIVE_GATE_ITEMS = [
  'understands_real_capital',
  'reviewed_strategy_backtest',
  'alpaca_live_key_configured',
  'accepts_safety_halts',
  'confirms_risk_tolerance',
];

export function evaluateLiveGate({
  consents,
  hasLiveCredentials,
}) {
  const missing =
    REQUIRED_LIVE_GATE_ITEMS
      .filter(
        (key) =>
          !consents?.[key]
      );

  const envEnabled =
    String(
      process.env
        .LIVE_TRADING_ENABLED
    ).toLowerCase() ===
    'true';

  if (
    missing.length >
    0
  ) {
    return {
      allowed: false,

      reason:
        `Live Gate incomplete: missing consent for ${missing.join(', ')}`,
    };
  }

  if (!envEnabled) {
    return {
      allowed: false,

      reason:
        'LIVE_TRADING_ENABLED is not set to true on the server.',
    };
  }

  if (
    !hasLiveCredentials
  ) {
    return {
      allowed: false,

      reason:
        'No Alpaca live credentials on file.',
    };
  }

  return {
    allowed: true,
    reason: null,
  };
}
