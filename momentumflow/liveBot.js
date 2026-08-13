import { v4 as uuid } from 'uuid';

export const MARKETS = {
  crypto: [
    'BTC',
    'ETH',
    'SOL',
  ],

  equity: [
    'SPY',
    'QQQ',
    'GLD',
    'GBTC',
  ],
};

export const CONVICTION_MULTIPLIERS = {
  probe:
    0.5,

  standard:
    1.0,

  high:
    1.25,
};

export function createSession({
  mode,
  startingCapital,
}) {
  const now =
    new Date().toISOString();

  return {
    id:
      uuid(),

    mode,

    status:
      'running',

    starting_capital:
      startingCapital,

    ending_capital:
      startingCapital,

    total_pnl:
      0,

    return_pct:
      0,

    trades:
      0,

    wins:
      0,

    losses:
      0,

    consecutive_losses:
      0,

    win_rate:
      0,

    profit_factor:
      0,

    expectancy:
      0,

    average_win:
      0,

    average_loss:
      0,

    payoff_ratio:
      0,

    max_drawdown_pct:
      0,

    markets_traded:
      [],

    halt_reason:
      null,

    created_at:
      now,

    updated_at:
      now,

    completed_at:
      null,
  };
}

export function createTrade({
  sessionId,
  market,
  marketName,
  direction,
  conviction,
  entryPrice,
}) {
  const multiplier =
    CONVICTION_MULTIPLIERS[
      conviction
    ] ??
    1.0;

  return {
    id:
      uuid(),

    session_id:
      sessionId,

    market,

    market_name:
      marketName,

    direction,

    conviction,

    multiplier,

    entry_price:
      entryPrice,

    exit_price:
      null,

    pnl:
      null,

    result:
      null,

    timestamp:
      new Date().toISOString(),
  };
}

export function recomputeSessionStats(
  session,
  trades
) {
  const sessionTrades =
    trades
      .filter(
        (
          trade
        ) =>
          trade.session_id ===
            session.id &&
          trade.result !==
            null
      )
      .sort(
        (
          a,
          b
        ) =>
          new Date(
            a.closed_at ||
            a.timestamp ||
            0
          ) -
          new Date(
            b.closed_at ||
            b.timestamp ||
            0
          )
      );

  const winningTrades =
    sessionTrades.filter(
      (
        trade
      ) =>
        Number(
          trade.pnl
        ) >
        0
    );

  const losingTrades =
    sessionTrades.filter(
      (
        trade
      ) =>
        Number(
          trade.pnl
        ) <
        0
    );

  const wins =
    winningTrades.length;

  const losses =
    losingTrades.length;

  const grossWin =
    winningTrades.reduce(
      (
        sum,
        trade
      ) =>
        sum +
        Number(
          trade.pnl ||
          0
        ),
      0
    );

  const grossLossAbs =
    Math.abs(
      losingTrades.reduce(
        (
          sum,
          trade
        ) =>
          sum +
          Number(
            trade.pnl ||
            0
          ),
        0
      )
    );

  const totalPnl =
    sessionTrades.reduce(
      (
        sum,
        trade
      ) =>
        sum +
        Number(
          trade.pnl ||
          0
        ),
      0
    );

  const averageWin =
    wins > 0
      ? grossWin /
        wins
      : 0;

  const averageLoss =
    losses > 0
      ? grossLossAbs /
        losses
      : 0;

  const winRateFraction =
    sessionTrades.length >
    0
      ? wins /
        sessionTrades.length
      : 0;

  const lossRateFraction =
    sessionTrades.length >
    0
      ? losses /
        sessionTrades.length
      : 0;

  const expectancy =
    winRateFraction *
      averageWin -
    lossRateFraction *
      averageLoss;

  const payoffRatio =
    averageLoss > 0
      ? averageWin /
        averageLoss
      : averageWin > 0
        ? Infinity
        : 0;

  let equity =
    Number(
      session
        .starting_capital ||
      0
    );

  let peak =
    equity;

  let maxDrawdownFraction =
    0;

  for (
    const trade of
    sessionTrades
  ) {
    equity +=
      Number(
        trade.pnl ||
        0
      );

    peak =
      Math.max(
        peak,
        equity
      );

    if (
      peak > 0
    ) {
      const drawdown =
        (
          peak -
          equity
        ) /
        peak;

      maxDrawdownFraction =
        Math.max(
          maxDrawdownFraction,
          drawdown
        );
    }
  }

  const marketsTraded =
    [
      ...new Set(
        sessionTrades.map(
          (
            trade
          ) =>
            trade.market
        )
      ),
    ];

  session.trades =
    sessionTrades.length;

  session.wins =
    wins;

  session.losses =
    losses;

  session.win_rate =
    sessionTrades.length >
    0
      ? Number(
          (
            winRateFraction *
            100
          ).toFixed(
            2
          )
        )
      : 0;

  session.profit_factor =
    grossLossAbs > 0
      ? Number(
          (
            grossWin /
            grossLossAbs
          ).toFixed(
            2
          )
        )
      : grossWin > 0
        ? Infinity
        : 0;

  session.expectancy =
    Number(
      expectancy.toFixed(
        4
      )
    );

  session.average_win =
    Number(
      averageWin.toFixed(
        4
      )
    );

  session.average_loss =
    Number(
      averageLoss.toFixed(
        4
      )
    );

  session.payoff_ratio =
    Number.isFinite(
      payoffRatio
    )
      ? Number(
          payoffRatio.toFixed(
            3
          )
        )
      : payoffRatio;

  session.max_drawdown_pct =
    Number(
      (
        maxDrawdownFraction *
        100
      ).toFixed(
        2
      )
    );

  session.total_pnl =
    Number(
      totalPnl.toFixed(
        2
      )
    );

  session.ending_capital =
    Number(
      (
        Number(
          session
            .starting_capital ||
          0
        ) +
        totalPnl
      ).toFixed(
        2
      )
    );

  session.return_pct =
    Number(
      session
        .starting_capital ||
      0
    ) >
    0
      ? Number(
          (
            (
              totalPnl /
              Number(
                session
                  .starting_capital
              )
            ) *
            100
          ).toFixed(
            2
          )
        )
      : 0;

  session.markets_traded =
    marketsTraded;

  session.updated_at =
    new Date().toISOString();

  return session;
}
