import express from 'express';
import { store } from './store.js';

import {
  createSession,
  createTrade,
  recomputeSessionStats,
} from './models.js';

import {
  checkHaltConditions,
  evaluateLiveGate,
  canTradeMarket,
} from './safetyEngine.js';

import {
  getAccount,
  getPositions,
  getTradableAssets,
  getMarketClock,
  getStockSnapshots,
  getCryptoSnapshots,
  getStockBars,
  getCryptoBars,
  getLatestTradablePrice,
  hasCredentials,
  placeOrder,
  getOrder,
  cancelOrder,
  waitForFill,
} from './alpacaClient.js';

import {
  STRATEGY_DEFAULTS,
  minuteMomentumPct,
  dailyDollarVolume,
  spreadPct,
  buildEquityMarketRegime,
  buildCryptoMarketRegime,
  buildEquitySignal,
  buildCryptoSignal,
  isCoolingDown,
} from './strategyEngine.js';

// UNIFIED BOT v17 PRECISION
//
// PAPER and LIVE use the same scanner, strategy, sizing,
// entry handling, position management, and exits.
//
// v17:
// - compatible with STRATEGY ENGINE v17 PRECISION
// - up to 3 simultaneous positions by default
// - staged equity/crypto scanning
// - LONG + easy-to-borrow SHORT equities
// - LONG-only crypto
// - dynamic strategy stop / take-profit / trailing / max-hold exits
// - terminal partial ENTRY fills tracked using actual filled quantity
// - open entry remainder cancelled and rechecked before recording trade
// - partial EXIT fills retried safely
// - startup recovery requires local open trades to match broker positions
//
// No strategy guarantees profit.
// Validate with Alpaca PAPER before using LIVE.

const router = express.Router();

const state = {
  running: false,
  mode: null,
  timer: null,
  sessionId: null,
  startedAt: null,
  lastTickAt: null,
  lastError: null,

  openTradeIds: [],
  exitRetryPending: false,

  lastDecision: 'stopped',

  signalSnapshot: {},
  topCandidates: [],

  universe: {
    equities: [],
    crypto: [],
    refreshedAt: null,
  },

  equityCursor: 0,
  marketOpen: null,
};

const DEFAULTS = {
  pollSeconds: 5,

  maxOpenPositions: 3,

  equityBatchSize: 75,

  universeRefreshMinutes: 15,

  minEquityPrice: 1,

  minDailyDollarVolume: 1000000,

  stockFeed: 'iex',

  fallbackTakeProfitPct: 0.60,

  fallbackStopLossPct: 0.40,

  fallbackMaxHoldMinutes: 15,

  entryWaitMs: 15000,

  entryCancelWaitMs: 30000,

  exitWaitMs: 15000,

  exitCancelWaitMs: 5000,

  maxExitAttempts: 3,
};

const tradingCfg = () => ({
  riskPerTrade: 0.02,

  ...store.getConfig(
    'tradingConfig',
    {}
  ),
});

const cfg = () => ({
  ...DEFAULTS,

  ...store.getConfig(
    'liveBotConfig',
    {}
  ),
});

const strategyCfg = () => ({
  ...STRATEGY_DEFAULTS,

  ...store.getConfig(
    'strategyConfig',
    {}
  ),
});

function maxOpenPositions() {
  const value =
    Math.trunc(
      Number(
        cfg().maxOpenPositions ??
        3
      )
    );

  if (
    !Number.isFinite(
      value
    )
  ) {
    return 3;
  }

  return Math.max(
    1,
    Math.min(
      10,
      value
    )
  );
}

function selectedMode() {
  const value =
    store.getConfig(
      'tradingMode',
      {
        mode: 'paper',
      }
    ).mode;

  return value === 'live'
    ? 'live'
    : 'paper';
}

function accessCheck(
  mode
) {
  if (
    mode ===
    'live'
  ) {
    return evaluateLiveGate({
      consents:
        store.getConfig(
          'liveGateConsents',
          {}
        ),

      hasLiveCredentials:
        hasCredentials(
          'live'
        ),
    });
  }

  if (
    !hasCredentials(
      'paper'
    )
  ) {
    return {
      allowed: false,

      reason:
        'No Alpaca paper credentials on file.',
    };
  }

  return {
    allowed: true,
    reason: null,
  };
}

function pub() {
  return {
    running:
      state.running,

    mode:
      state.mode,

    sessionId:
      state.sessionId,

    startedAt:
      state.startedAt,

    lastTickAt:
      state.lastTickAt,

    lastError:
      state.lastError,

    openTradeId:
      state.openTradeIds[0] ||
      null,

    openTradeIds:
      [
        ...state.openTradeIds,
      ],

    openPositionCount:
      state.openTradeIds.length,

    maxOpenPositions:
      maxOpenPositions(),

    exitRetryPending:
      state.exitRetryPending,

    lastDecision:
      state.lastDecision,

    signalSnapshot:
      state.signalSnapshot,

    topCandidates:
      state.topCandidates,

    marketOpen:
      state.marketOpen,

    universe: {
      equityCount:
        state.universe
          .equities.length,

      cryptoCount:
        state.universe
          .crypto.length,

      totalCount:
        state.universe
          .equities.length +
        state.universe
          .crypto.length,

      refreshedAt:
        state.universe
          .refreshedAt,

      equityCursor:
        state.equityCursor,
    },

    config: {
      ...cfg(),

      maxOpenPositions:
        maxOpenPositions(),

      riskPerTrade:
        Number(
          tradingCfg()
            .riskPerTrade ??
          0.02
        ),

      sizingMode:
        'alpaca_account_equity_fraction',

      equityDirections:
        'LONG_AND_SHORT',

      cryptoDirections:
        'LONG_ONLY',

      execution:
        state.mode ===
        'paper'
          ? 'ALPACA_PAPER'
          : state.mode ===
              'live'
            ? 'ALPACA_LIVE'
            : null,
    },

    strategyVersion:
      'v17-precision',

    strategyConfig:
      strategyCfg(),
  };
}

function stop(
  reason = null
) {
  if (
    state.timer
  ) {
    clearTimeout(
      state.timer
    );
  }

  state.timer =
    null;

  state.running =
    false;

  if (reason) {
    state.lastError =
      reason;
  }
}

function schedule() {
  if (
    !state.running
  ) {
    return;
  }

  const seconds =
    Math.max(
      2,

      Number(
        cfg().pollSeconds ||
        5
      )
    );

  state.timer =
    setTimeout(
      tick,
      seconds * 1000
    );
}

function normPos(
  symbol = ''
) {
  const value =
    String(
      symbol ||
      ''
    ).toUpperCase();

  if (
    value.includes(
      '/'
    )
  ) {
    return value;
  }

  if (
    /^[A-Z]+USD$/.test(
      value
    )
  ) {
    return `${value.slice(
      0,
      -3
    )}/USD`;
  }

  return value;
}

function positiveQtyString(
  value
) {
  if (
    value == null
  ) {
    return null;
  }

  const raw =
    String(
      value
    ).trim();

  if (!raw) {
    return null;
  }

  return raw.startsWith(
    '-'
  )
    ? raw.slice(1)
    : raw;
}

function findMatchingPosition(
  positions,
  market
) {
  const wanted =
    normPos(
      market
    );

  return (
    (
      positions ||
      []
    ).find(
      (
        position
      ) => {
        const qty =
          Math.abs(
            Number(
              position
                ?.qty ||
              0
            )
          );

        return (
          qty > 0 &&
          normPos(
            position
              ?.symbol
          ) ===
            wanted
        );
      }
    ) ||
    null
  );
}

function getSessionOpenTrades() {
  if (
    !state.sessionId
  ) {
    return [];
  }

  return store
    .getAll(
      'trades'
    )
    .filter(
      (
        trade
      ) =>
        trade.session_id ===
          state.sessionId &&
        trade.result ===
          null
    );
}

function syncOpenTradeIds() {
  state.openTradeIds =
    getSessionOpenTrades()
      .map(
        (
          trade
        ) =>
          trade.id
      );

  return state.openTradeIds;
}

function saveTradePatch(
  tradeId,
  patch
) {
  const trades =
    store.getAll(
      'trades'
    );

  const index =
    trades.findIndex(
      (
        trade
      ) =>
        trade.id ===
        tradeId
    );

  if (
    index < 0
  ) {
    throw new Error(
      `Trade ${tradeId} was not found.`
    );
  }

  trades[index] = {
    ...trades[index],
    ...patch,
  };

  store.saveAll(
    'trades',
    trades
  );

  return trades[index];
}

function isOrderStillOpen(
  status
) {
  return [
    'accepted',
    'new',
    'partially_filled',
    'pending_new',
    'pending_cancel',
    'accepted_for_bidding',
    'stopped',
    'suspended',
    'calculated',
    'done_for_day',
  ].includes(
    String(
      status ||
      ''
    )
  );
}

async function settleOrder({
  mode,
  orderId,
  initialWaitMs,
  cancelWaitMs,
  label,
}) {
  let order =
    await waitForFill(
      mode,
      orderId,
      {
        timeoutMs:
          initialWaitMs,

        intervalMs:
          750,
      }
    );

  if (
    order.status ===
    'filled'
  ) {
    return order;
  }

  if (
    isOrderStillOpen(
      order.status
    )
  ) {
    try {
      await cancelOrder(
        mode,
        orderId
      );
    } catch (
      error
    ) {
      console.warn(
        `[${mode}-bot] ${label} cancel ${orderId}: ${error.message}`
      );
    }

    order =
      await waitForFill(
        mode,
        orderId,
        {
          timeoutMs:
            cancelWaitMs,

          intervalMs:
            500,
        }
      );

    order =
      await getOrder(
        mode,
        orderId
      );
  }

  return order;
}

async function refreshUniverse(
  mode,
  force = false
) {
  const c =
    cfg();

  const age =
    state.universe
      .refreshedAt
      ? Date.now() -
        new Date(
          state.universe
            .refreshedAt
        ).getTime()
      : Infinity;

  if (
    !force &&
    age <
      Number(
        c.universeRefreshMinutes
      ) *
        60000
  ) {
    return;
  }

  const assets =
    await getTradableAssets(
      mode
    );

  state.universe = {
    equities:
      assets.equities ||
      [],

    crypto:
      assets.crypto ||
      [],

    refreshedAt:
      new Date()
        .toISOString(),
  };

  if (
    state.equityCursor >=
    state.universe
      .equities.length
  ) {
    state.equityCursor =
      0;
  }
}

function buildBlockedSymbols(
  positions,
  trades
) {
  const blocked =
    new Set(
      (
        positions ||
        []
      )
        .filter(
          (
            position
          ) =>
            Math.abs(
              Number(
                position.qty ||
                0
              )
            ) >
            0
        )
        .map(
          (
            position
          ) =>
            normPos(
              position.symbol
            )
        )
    );

  for (
    const trade of
    trades ||
    []
  ) {
    if (
      trade.result ===
      null
    ) {
      blocked.add(
        normPos(
          trade.market
        )
      );
    }
  }

  return blocked;
}

function stockBatch() {
  if (
    !state.universe
      .equities.length
  ) {
    return [];
  }

  const count =
    Math.min(
      Number(
        cfg()
          .equityBatchSize
      ),

      state.universe
        .equities.length
    );

  const batch =
    [];

  for (
    let i = 0;
    i < count;
    i += 1
  ) {
    const index =
      (
        state.equityCursor +
        i
      ) %
      state.universe
        .equities.length;

    batch.push(
      state.universe
        .equities[
          index
        ]
    );
  }

  state.equityCursor =
    (
      state.equityCursor +
      count
    ) %
    state.universe
      .equities.length;

  return batch;
}

function rankSignal(
  signal,
  preMomentum = 0
) {
  const trend =
    Math.abs(
      Number(
        signal
          ?.signal
          ?.trend15Pct ||
        0
      )
    );

  const volume =
    Number(
      signal
        ?.signal
        ?.recentVolumeRatio ||
      0
    );

  return (
    Number(
      signal?.score ||
      0
    ) +

    Math.min(
      1.5,
      trend * 3
    ) +

    Math.min(
      1,
      Math.max(
        0,
        volume - 1
      )
    ) +

    Math.min(
      0.5,
      Math.abs(
        Number(
          preMomentum ||
          0
        )
      ) *
        2
    )
  );
}

async function scan(
  mode
) {
  await refreshUniverse(
    mode
  );

  const c =
    cfg();

  const sc =
    strategyCfg();

  const session =
    store.getOne(
      'sessions',
      state.sessionId
    );

  if (!session) {
    throw new Error(
      'Bot session was not found.'
    );
  }

  const trades =
    store
      .getAll(
        'trades'
      )
      .filter(
        (
          trade
        ) =>
          trade.session_id ===
          session.id
      );

  const positions =
    await getPositions(
      mode
    );

  const blocked =
    buildBlockedSymbols(
      positions,
      trades
    );

  const now =
    new Date();

  const finalCandidates =
    [];

  const snapshotsForStatus =
    {};

  // ========================================
  // CRYPTO
  // ========================================

  const cryptoSymbols =
    state.universe
      .crypto
      .map(
        (
          asset
        ) =>
          asset.symbol
      )
      .filter(
        Boolean
      );

  if (
    cryptoSymbols.length
  ) {
    const snapshots =
      await getCryptoSnapshots(
        mode,
        cryptoSymbols
      );

    const pre =
      [];

    for (
      const asset of
      state.universe
        .crypto
    ) {
      const compact =
        String(
          asset.symbol ||
          ''
        ).replace(
          '/',
          ''
        );

      const snapshot =
        snapshots[
          asset.symbol
        ] ||
        snapshots[
          compact
        ];

      if (!snapshot) {
        continue;
      }

      const momentum =
        minuteMomentumPct(
          snapshot
        );

      const spread =
        spreadPct(
          snapshot
        );

      const eligible =
        !blocked.has(
          normPos(
            asset.symbol
          )
        ) &&

        canTradeMarket(
          trades,
          asset.symbol
        ) &&

        !isCoolingDown(
          trades,
          asset.symbol,

          Number(
            sc
              .cryptoCooldownMinutes
          )
        );

      snapshotsForStatus[
        asset.symbol
      ] = {
        assetClass:
          'crypto',

        minuteMomentumPct:
          momentum == null
            ? null
            : Number(
                momentum
                  .toFixed(
                    4
                  )
              ),

        spreadPct:
          spread == null
            ? null
            : Number(
                spread
                  .toFixed(
                    4
                  )
              ),

        eligible,
      };

      if (
        !eligible ||
        momentum == null
      ) {
        continue;
      }

      if (
        momentum <
        Number(
          sc
            .cryptoPrefilterMomentumPct
        )
      ) {
        continue;
      }

      if (
        spread != null &&
        spread >
          Number(
            sc
              .maxCryptoSpreadPct
          )
      ) {
        continue;
      }

      pre.push({
        asset,
        snapshot,
        momentum,
      });
    }

    pre.sort(
      (
        a,
        b
      ) =>
        b.momentum -
        a.momentum
    );

    const shortlist =
      pre.slice(
        0,

        Math.max(
          1,

          Number(
            sc
              .maxDetailedCrypto
          )
        )
      );

    if (
      shortlist.length
    ) {
      const detailSymbols =
        [
          ...new Set([
            ...shortlist.map(
              (
                item
              ) =>
                item.asset
                  .symbol
            ),

            'BTC/USD',
          ]),
        ];

      const barsBySymbol =
        await getCryptoBars(
          mode,
          detailSymbols,
          {
            timeframe:
              '1Min',

            start:
              new Date(
                Date.now() -
                90 *
                  60000
              ),

            end:
              now,

            limit:
              10000,
          }
        );

      const btcRegime =
        buildCryptoMarketRegime(
          barsBySymbol[
            'BTC/USD'
          ] ||
          []
        );

      for (
        const item of
        shortlist
      ) {
        const signal =
          buildCryptoSignal({
            asset:
              item.asset,

            snapshot:
              item.snapshot,

            bars:
              barsBySymbol[
                item.asset
                  .symbol
              ] ||
              [],

            btcRegime,

            config:
              sc,

            now,
          });

        if (!signal) {
          continue;
        }

        signal.prefilterMomentumPct =
          Number(
            item.momentum
              .toFixed(
                4
              )
          );

        signal.rank =
          rankSignal(
            signal,
            item.momentum
          );

        finalCandidates.push(
          signal
        );
      }
    }
  }

  // ========================================
  // EQUITIES
  // ========================================

  const clock =
    await getMarketClock(
      mode
    );

  state.marketOpen =
    Boolean(
      clock?.is_open
    );

  if (
    state.marketOpen &&
    state.universe
      .equities.length
  ) {
    const batch =
      stockBatch();

    const snapshots =
      await getStockSnapshots(
        mode,

        batch.map(
          (
            asset
          ) =>
            asset.symbol
        ),

        {
          feed:
            c.stockFeed,
        }
      );

    const pre =
      [];

    for (
      const asset of
      batch
    ) {
      const snapshot =
        snapshots[
          asset.symbol
        ];

      if (!snapshot) {
        continue;
      }

      const price =
        Number(
          snapshot
            ?.latestTrade
            ?.p ??
          snapshot
            ?.minuteBar
            ?.c ??
          snapshot
            ?.dailyBar
            ?.c
        );

      if (
        !Number.isFinite(
          price
        ) ||
        price <
          Number(
            c.minEquityPrice
          )
      ) {
        continue;
      }

      const dollarVolume =
        dailyDollarVolume(
          snapshot
        );

      if (
        dollarVolume <
        Number(
          c
            .minDailyDollarVolume
        )
      ) {
        continue;
      }

      const momentum =
        minuteMomentumPct(
          snapshot
        );

      const spread =
        spreadPct(
          snapshot
        );

      const eligible =
        !blocked.has(
          normPos(
            asset.symbol
          )
        ) &&

        canTradeMarket(
          trades,
          asset.symbol
        ) &&

        !isCoolingDown(
          trades,
          asset.symbol,

          Number(
            sc
              .equityCooldownMinutes
          )
        );

      snapshotsForStatus[
        asset.symbol
      ] = {
        assetClass:
          'us_equity',

        minuteMomentumPct:
          momentum == null
            ? null
            : Number(
                momentum
                  .toFixed(
                    4
                  )
              ),

        dollarVolume:
          Math.round(
            dollarVolume
          ),

        spreadPct:
          spread == null
            ? null
            : Number(
                spread
                  .toFixed(
                    4
                  )
              ),

        shortable:
          asset.shortable ===
          true,

        easyToBorrow:
          asset.easy_to_borrow ===
          true,

        eligible,
      };

      if (
        !eligible ||
        momentum == null
      ) {
        continue;
      }

      const threshold =
        Number(
          sc
            .equityPrefilterMomentumPct
        );

      const longPrefilter =
        momentum >=
        threshold;

      const shortPrefilter =
        momentum <=
          -threshold &&

        asset.shortable ===
          true &&

        asset.easy_to_borrow ===
          true;

      if (
        !longPrefilter &&
        !shortPrefilter
      ) {
        continue;
      }

      if (
        spread != null &&
        spread >
          Number(
            sc
              .maxEquitySpreadPct
          )
      ) {
        continue;
      }

      pre.push({
        asset,
        snapshot,
        momentum,
      });
    }

    pre.sort(
      (
        a,
        b
      ) =>
        Math.abs(
          b.momentum
        ) -
        Math.abs(
          a.momentum
        )
    );

    const shortlist =
      pre.slice(
        0,

        Math.max(
          1,

          Number(
            sc
              .maxDetailedEquities
          )
        )
      );

    if (
      shortlist.length
    ) {
      const detailSymbols =
        [
          ...new Set([
            ...shortlist.map(
              (
                item
              ) =>
                item.asset
                  .symbol
            ),

            'SPY',
            'QQQ',
          ]),
        ];

      const barsBySymbol =
        await getStockBars(
          mode,
          detailSymbols,
          {
            timeframe:
              '1Min',

            start:
              new Date(
                Date.now() -
                12 *
                  60 *
                  60000
              ),

            end:
              now,

            limit:
              10000,

            feed:
              c.stockFeed,
          }
        );

      const marketRegime =
        buildEquityMarketRegime(
          barsBySymbol
            .SPY ||
          [],

          barsBySymbol
            .QQQ ||
          []
        );

      for (
        const item of
        shortlist
      ) {
        const signal =
          buildEquitySignal({
            asset:
              item.asset,

            snapshot:
              item.snapshot,

            bars:
              barsBySymbol[
                item.asset
                  .symbol
              ] ||
              [],

            marketRegime,

            config:
              sc,

            now,
          });

        if (!signal) {
          continue;
        }

        signal.prefilterMomentumPct =
          Number(
            item.momentum
              .toFixed(
                4
              )
          );

        signal.rank =
          rankSignal(
            signal,
            item.momentum
          );

        finalCandidates.push(
          signal
        );
      }
    }
  }

  finalCandidates.sort(
    (
      a,
      b
    ) =>
      Number(
        b.rank ||
        b.score
      ) -
      Number(
        a.rank ||
        a.score
      )
  );

  state.signalSnapshot =
    Object.fromEntries(
      Object.entries(
        snapshotsForStatus
      ).slice(
        -30
      )
    );

  state.topCandidates =
    finalCandidates
      .slice(
        0,
        10
      )
      .map(
        (
          candidate
        ) => ({
          symbol:
            candidate
              .symbol,

          assetClass:
            candidate
              .assetClass,

          direction:
            candidate
              .direction,

          strategy:
            candidate
              .strategy,

          score:
            candidate
              .score,

          price:
            Number(
              candidate
                .price
                .toFixed(
                  8
                )
            ),

          minuteMomentumPct:
            candidate
              .prefilterMomentumPct,

          trend5Pct:
            candidate
              .signal
              ?.trend5Pct ??
            null,

          trend15Pct:
            candidate
              .signal
              ?.trend15Pct ??
            null,

          recentVolumeRatio:
            candidate
              .signal
              ?.recentVolumeRatio ??
            null,

          spreadPct:
            candidate
              .signal
              ?.spreadPct ??
            null,

          breakoutType:
            candidate
              .signal
              ?.breakoutType ??
            null,

          vwapDistanceAtr:
            candidate
              .signal
              ?.vwapDistanceAtr ??
            null,

          breakoutDistanceAtr:
            candidate
              .signal
              ?.breakoutDistanceAtr ??
            null,
        })
      );

  return (
    finalCandidates[0] ||
    null
  );
}

function finalizeTradeClosure(
  mode,
  trade,
  {
    exitQty,
    exitValue,
    reason,
    exitOrderIds = [],
    reconciled = false,
  }
) {
  const qty =
    Number(
      exitQty
    );

  const value =
    Number(
      exitValue
    );

  if (
    !Number.isFinite(
      qty
    ) ||
    qty <= 0 ||
    !Number.isFinite(
      value
    ) ||
    value <= 0
  ) {
    throw new Error(
      `Cannot finalize ${trade.market}; no valid executed exit quantity/value.`
    );
  }

  const exitPrice =
    value /
    qty;

  const entryPrice =
    Number(
      trade.entry_price
    );

  if (
    !Number.isFinite(
      entryPrice
    ) ||
    entryPrice <= 0
  ) {
    throw new Error(
      `Invalid entry price for ${trade.market}.`
    );
  }

  const direction =
    trade.direction ===
    'SHORT'
      ? 'SHORT'
      : 'LONG';

  const pnl =
    direction ===
    'SHORT'
      ? (
          entryPrice -
          exitPrice
        ) *
        qty
      : (
          exitPrice -
          entryPrice
        ) *
        qty;

  const result =
    pnl >= 0
      ? 'win'
      : 'loss';

  const trades =
    store.getAll(
      'trades'
    );

  const index =
    trades.findIndex(
      (
        item
      ) =>
        item.id ===
        trade.id
    );

  if (
    index < 0
  ) {
    throw new Error(
      `Trade ${trade.id} was not found during exit finalization.`
    );
  }

  trades[index] = {
    ...trades[index],

    exit_price:
      exitPrice,

    pnl:
      Number(
        pnl.toFixed(
          4
        )
      ),

    result,

    exit_reason:
      reason,

    exit_qty:
      qty,

    exit_order_id:
      exitOrderIds[
        exitOrderIds.length -
        1
      ] ||
      null,

    exit_order_ids:
      [
        ...exitOrderIds,
      ],

    reconciled_exit:
      Boolean(
        reconciled
      ),

    closed_at:
      new Date()
        .toISOString(),
  };

  store.saveAll(
    'trades',
    trades
  );

  const session =
    store.getOne(
      'sessions',
      trade.session_id
    );

  if (session) {
    session.consecutive_losses =
      result ===
      'loss'
        ? Number(
            session
              .consecutive_losses ||
            0
          ) +
          1
        : 0;

    recomputeSessionStats(
      session,
      trades
    );

    store.update(
      'sessions',
      session.id,
      session
    );
  }

  state.openTradeIds =
    state.openTradeIds
      .filter(
        (
          id
        ) =>
          id !==
          trade.id
      );

  state.exitRetryPending =
    false;

  state.lastDecision =
    `closed ${mode.toUpperCase()} ${direction} ${trade.market} ` +
    `qty ${qty} at ${exitPrice} — ${reason}`;

  return true;
}

async function closeTrade(
  mode,
  trade,
  price,
  reason
) {
  const recordedQty =
    Number(
      positiveQtyString(
        trade
          .filled_qty ??
        trade.qty
      )
    );

  if (
    !Number.isFinite(
      recordedQty
    ) ||
    recordedQty <= 0
  ) {
    throw new Error(
      `Open trade ${trade.id} has no filled quantity to close.`
    );
  }

  const direction =
    trade.direction ===
    'SHORT'
      ? 'SHORT'
      : 'LONG';

  const assetClass =
    trade.asset_class ||
    (
      String(
        trade.market
      ).includes(
        '/'
      )
        ? 'crypto'
        : 'us_equity'
    );

  const crypto =
    assetClass ===
    'crypto';

  let totalExitQty =
    0;

  let totalExitValue =
    0;

  const exitOrderIds =
    [];

  for (
    let attempt = 1;
    attempt <=
      Number(
        cfg()
          .maxExitAttempts ||
        3
      );
    attempt += 1
  ) {
    const positions =
      await getPositions(
        mode
      );

    const position =
      findMatchingPosition(
        positions,
        trade.market
      );

    const tolerance =
      Math.max(
        recordedQty *
          0.002,

        1e-12
      );

    const remainingRecorded =
      Math.max(
        0,

        recordedQty -
        totalExitQty
      );

    if (
      remainingRecorded <=
      tolerance
    ) {
      return finalizeTradeClosure(
        mode,
        trade,
        {
          exitQty:
            totalExitQty,

          exitValue:
            totalExitValue,

          reason,

          exitOrderIds,

          reconciled:
            attempt >
            1,
        }
      );
    }

    if (!position) {
      if (
        totalExitQty >
        0
      ) {
        return finalizeTradeClosure(
          mode,
          trade,
          {
            exitQty:
              totalExitQty,

            exitValue:
              totalExitValue,

            reason,

            exitOrderIds,

            reconciled:
              true,
          }
        );
      }

      throw new Error(
        `No matching Alpaca ${mode} position exists for ${trade.market}.`
      );
    }

    const availableQtyString =
      positiveQtyString(
        position
          .qty_available ??
        position.qty
      );

    const availableQty =
      Number(
        availableQtyString
      );

    if (
      !Number.isFinite(
        availableQty
      ) ||
      availableQty <= 0
    ) {
      throw new Error(
        `Alpaca reports no available quantity to close for ${trade.market}.`
      );
    }

    const closeQty =
      Math.min(
        availableQty,
        remainingRecorded
      );

    if (
      !Number.isFinite(
        closeQty
      ) ||
      closeQty <= 0
    ) {
      throw new Error(
        `Invalid close quantity for ${trade.market}.`
      );
    }

    const closeQtyString =
      Math.abs(
        closeQty -
        availableQty
      ) <=
      Math.max(
        availableQty *
          1e-12,

        1e-12
      )
        ? availableQtyString
        : String(
            Number(
              closeQty
                .toFixed(
                  12
                )
            )
          );

    const side =
      direction ===
      'SHORT'
        ? 'buy'
        : 'sell';

    state.lastDecision =
      `closing ${mode.toUpperCase()} ${direction} ${trade.market} ` +
      `qty ${closeQtyString} — ${reason} — attempt ${attempt}`;

    const order =
      await placeOrder({
        mode,

        symbol:
          trade.market,

        qty:
          closeQtyString,

        side,

        type:
          'market',

        timeInForce:
          crypto
            ? 'gtc'
            : 'day',
      });

    const settled =
      await settleOrder({
        mode,

        orderId:
          order.id,

        initialWaitMs:
          Number(
            cfg()
              .exitWaitMs ||
            15000
          ),

        cancelWaitMs:
          Number(
            cfg()
              .exitCancelWaitMs ||
            5000
          ),

        label:
          'exit',
      });

    if (
      isOrderStillOpen(
        settled.status
      )
    ) {
      throw new Error(
        `Exit order ${order.id} is still ${settled.status} after cancel/recheck. ` +
        `Bot stopped to avoid duplicate exits.`
      );
    }

    const fillQty =
      Number(
        settled
          .filled_qty ||
        0
      );

    const fillPrice =
      Number(
        settled
          .filled_avg_price
      );

    exitOrderIds.push(
      order.id
    );

    if (
      fillQty >
      0
    ) {
      if (
        !Number.isFinite(
          fillPrice
        ) ||
        fillPrice <= 0
      ) {
        throw new Error(
          `Exit order ${order.id} filled ${fillQty} but has no valid filled_avg_price.`
        );
      }

      totalExitQty +=
        fillQty;

      totalExitValue +=
        fillQty *
        fillPrice;
    }

    const afterPositions =
      await getPositions(
        mode
      );

    const remainingPosition =
      findMatchingPosition(
        afterPositions,
        trade.market
      );

    if (
      !remainingPosition
    ) {
      if (
        totalExitQty <=
        0
      ) {
        throw new Error(
          `Alpaca no longer shows ${trade.market}, but no executed exit quantity was reported.`
        );
      }

      return finalizeTradeClosure(
        mode,
        trade,
        {
          exitQty:
            totalExitQty,

          exitValue:
            totalExitValue,

          reason,

          exitOrderIds,

          reconciled:
            attempt >
              1 ||
            settled.status !==
              'filled',
        }
      );
    }

    if (
      fillQty <= 0 &&
      [
        'rejected',
        'expired',
        'canceled',
      ].includes(
        String(
          settled.status ||
          ''
        )
      )
    ) {
      throw new Error(
        `Exit order ${order.id} ended ${settled.status} without a fill for ${trade.market}.`
      );
    }
  }

  state.exitRetryPending =
    true;

  throw new Error(
    `Partial exit remains for ${trade.market} after retry limit. ` +
    `Check the Alpaca ${mode} account before restarting.`
  );
}

async function manageOne(
  mode,
  trade
) {
  const direction =
    trade.direction ===
    'SHORT'
      ? 'SHORT'
      : 'LONG';

  const assetClass =
    trade.asset_class ||
    (
      String(
        trade.market
      ).includes(
        '/'
      )
        ? 'crypto'
        : 'us_equity'
    );

  const price =
    await getLatestTradablePrice(
      mode,
      trade.market,
      assetClass
    );

  const entryPrice =
    Number(
      trade.entry_price
    );

  if (
    !Number.isFinite(
      entryPrice
    ) ||
    entryPrice <= 0
  ) {
    throw new Error(
      `Invalid entry price for ${trade.market}.`
    );
  }

  const rawMove =
    (
      (
        price -
        entryPrice
      ) /
      entryPrice
    ) *
    100;

  const favorableMove =
    direction ===
    'SHORT'
      ? -rawMove
      : rawMove;

  const openedAt =
    trade.timestamp ||
    trade.created_at;

  const openedAtMs =
    openedAt
      ? new Date(
          openedAt
        ).getTime()
      : Date.now();

  const ageMinutes =
    (
      Date.now() -
      openedAtMs
    ) /
    60000;

  const c =
    cfg();

  const takeProfitPct =
    Number(
      trade
        .take_profit_pct ??
      c
        .fallbackTakeProfitPct
    );

  const stopLossPct =
    Number(
      trade
        .stop_loss_pct ??
      c
        .fallbackStopLossPct
    );

  const trailTriggerPct =
    Number(
      trade
        .trail_trigger_pct ??
      Infinity
    );

  const trailDistancePct =
    Number(
      trade
        .trail_distance_pct ??
      Infinity
    );

  const maxHoldMinutes =
    Number(
      trade
        .max_hold_minutes ??
      c
        .fallbackMaxHoldMinutes
    );

  const previousBest =
    Number(
      trade
        .best_favorable_move_pct ||
      0
    );

  const bestMove =
    Math.max(
      previousBest,
      favorableMove
    );

  if (
    bestMove >
    previousBest
  ) {
    saveTradePatch(
      trade.id,
      {
        best_favorable_move_pct:
          Number(
            bestMove
              .toFixed(
                4
              )
          ),

        last_mark_price:
          price,

        last_mark_at:
          new Date()
            .toISOString(),
      }
    );
  }

  if (
    favorableMove >=
    takeProfitPct
  ) {
    await closeTrade(
      mode,
      trade,
      price,

      `${direction} dynamic take profit +${favorableMove.toFixed(
        3
      )}%`
    );

    return 'closed';
  }

  if (
    favorableMove <=
    -stopLossPct
  ) {
    await closeTrade(
      mode,
      trade,
      price,

      `${direction} dynamic stop loss ${favorableMove.toFixed(
        3
      )}%`
    );

    return 'closed';
  }

  if (
    Number.isFinite(
      trailTriggerPct
    ) &&

    Number.isFinite(
      trailDistancePct
    ) &&

    bestMove >=
      trailTriggerPct &&

    favorableMove <=
      bestMove -
      trailDistancePct
  ) {
    await closeTrade(
      mode,
      trade,
      price,

      `${direction} trailing exit; best +${bestMove.toFixed(
        3
      )}%, now ${favorableMove.toFixed(
        3
      )}%`
    );

    return 'closed';
  }

  if (
    ageMinutes >=
    maxHoldMinutes
  ) {
    await closeTrade(
      mode,
      trade,
      price,

      `${direction} max hold ${ageMinutes.toFixed(
        1
      )}m`
    );

    return 'closed';
  }

  return 'open';
}

async function manageOpenTrades(
  mode
) {
  syncOpenTradeIds();

  for (
    const id of
    [
      ...state.openTradeIds,
    ]
  ) {
    const trade =
      store.getOne(
        'trades',
        id
      );

    if (
      !trade ||
      trade.result !==
        null
    ) {
      state.openTradeIds =
        state.openTradeIds
          .filter(
            (
              tradeId
            ) =>
              tradeId !==
              id
          );

      continue;
    }

    state.lastDecision =
      `managing ${mode.toUpperCase()} ${state.openTradeIds.length}/` +
      `${maxOpenPositions()} positions — ${trade.direction || 'LONG'} ${trade.market}`;

    await manageOne(
      mode,
      trade
    );
  }

  syncOpenTradeIds();

  return state
    .openTradeIds.length;
}

async function settleEntry(
  mode,
  orderId
) {
  const fill =
    await settleOrder({
      mode,

      orderId,

      initialWaitMs:
        Number(
          cfg()
            .entryWaitMs ||
          15000
        ),

      cancelWaitMs:
        Number(
          cfg()
            .entryCancelWaitMs ||
          30000
        ),

      label:
        'entry',
    });

  if (
    isOrderStillOpen(
      fill.status
    )
  ) {
    throw new Error(
      `Entry order ${orderId} is still ${fill.status} after cancel/recheck. ` +
      `Check the Alpaca ${mode} account before restarting the bot.`
    );
  }

  return fill;
}

async function enter(
  mode
) {
  syncOpenTradeIds();

  if (
    state.openTradeIds
      .length >=
    maxOpenPositions()
  ) {
    state.lastDecision =
      `${mode.toUpperCase()} managing ${state.openTradeIds.length}/` +
      `${maxOpenPositions()} open positions`;

    return false;
  }

  const session =
    store.getOne(
      'sessions',
      state.sessionId
    );

  if (!session) {
    throw new Error(
      'Bot session was not found.'
    );
  }

  const halt =
    checkHaltConditions(
      session
    );

  if (
    halt.halt
  ) {
    if (
      state.openTradeIds
        .length >
      0
    ) {
      state.lastDecision =
        `SAFETY HALT — no new entries (${halt.reason}); ` +
        `managing ${state.openTradeIds.length} open position(s)`;

      return false;
    }

    store.update(
      'sessions',
      session.id,
      {
        status:
          'halted',

        halt_reason:
          halt.reason,

        completed_at:
          new Date()
            .toISOString(),
      }
    );

    stop(
      `Safety halt: ${halt.reason}`
    );

    return false;
  }

  const best =
    await scan(
      mode
    );

  if (!best) {
    state.lastDecision =
      `${mode.toUpperCase()} scanning ` +
      `${state.universe.equities.length + state.universe.crypto.length} ` +
      `Alpaca tradable assets — ${state.openTradeIds.length}/` +
      `${maxOpenPositions()} positions open — waiting for v17 precision setup`;

    return false;
  }

  const direction =
    best.direction ||
    'LONG';

  state.lastDecision =
    `${mode.toUpperCase()} ${best.strategy} ${direction} ${best.symbol} ` +
    `score ${best.score}/10`;

  const account =
    await getAccount(
      mode
    );

  const buyingPower =
    Number(
      account
        .buying_power ||
      account.cash ||
      0
    );

  const equity =
    Number(
      account.equity ||
      account
        .portfolio_value ||
      account.cash ||
      0
    );

  const riskFraction =
    Number(
      tradingCfg()
        .riskPerTrade ??
      0.02
    );

  if (
    !Number.isFinite(
      riskFraction
    ) ||
    riskFraction <=
      0 ||
    riskFraction >
      1
  ) {
    throw new Error(
      'Risk per trade must be between 0 and 1 (0.02 = 2%).'
    );
  }

  const desiredNotional =
    equity *
    riskFraction;

  const positionBudget =
    Math.min(
      desiredNotional,
      buyingPower
    );

  if (
    !Number.isFinite(
      positionBudget
    ) ||
    positionBudget <
      1
  ) {
    throw new Error(
      `Insufficient ${mode} buying power for configured trade size.`
    );
  }

  let order;

  if (
    direction ===
    'SHORT'
  ) {
    if (
      best.assetClass !==
      'us_equity'
    ) {
      throw new Error(
        'Crypto short entries are disabled.'
      );
    }

    const qty =
      Math.floor(
        positionBudget /
        best.price
      );

    if (
      qty < 1
    ) {
      state.lastDecision =
        `${mode.toUpperCase()} SHORT ${best.symbol} skipped — ` +
        `$${positionBudget.toFixed(2)} budget is below one whole share at ` +
        `$${best.price.toFixed(2)}`;

      return false;
    }

    order =
      await placeOrder({
        mode,

        symbol:
          best.symbol,

        qty,

        side:
          'sell',

        type:
          'market',

        timeInForce:
          'day',
      });
  } else if (
    best.assetClass ===
      'us_equity' &&
    best.fractionable !==
      true
  ) {
    const qty =
      Math.floor(
        positionBudget /
        best.price
      );

    if (
      qty < 1
    ) {
      state.lastDecision =
        `${mode.toUpperCase()} LONG ${best.symbol} skipped — ` +
        `$${positionBudget.toFixed(2)} budget is below one whole share at ` +
        `$${best.price.toFixed(2)}`;

      return false;
    }

    order =
      await placeOrder({
        mode,

        symbol:
          best.symbol,

        qty,

        side:
          'buy',

        type:
          'market',

        timeInForce:
          'day',
      });
  } else {
    order =
      await placeOrder({
        mode,

        symbol:
          best.symbol,

        notional:
          Number(
            positionBudget
              .toFixed(
                2
              )
          ),

        side:
          'buy',

        type:
          'market',

        timeInForce:
          best.assetClass ===
          'crypto'
            ? 'gtc'
            : 'day',
      });
  }

  // ========================================
  // ENTRY FILL SAFETY v17
  // ========================================
  //
  // A partial fill is still a real broker position.
  //
  // Wait for completion.
  // If remainder stays open, cancel remainder.
  // Re-read the final order.
  //
  // Record ONLY filled_qty that Alpaca says actually executed.

  const fill =
    await settleEntry(
      mode,
      order.id
    );

  const filledQty =
    Number(
      fill.filled_qty ||
      0
    );

  // Terminal zero-fill is not a bot crash.
  if (
    !Number.isFinite(
      filledQty
    ) ||
    filledQty <=
      0
  ) {
    state.lastDecision =
      `${mode.toUpperCase()} ${direction} ${best.symbol} not opened — ` +
      `Alpaca order ${order.id} ended ${fill.status} with no fill`;

    return false;
  }

  const entryPrice =
    Number(
      fill
        .filled_avg_price
    );

  if (
    !Number.isFinite(
      entryPrice
    ) ||
    entryPrice <=
      0
  ) {
    throw new Error(
      `Entry order ${order.id} executed ${filledQty} of ${best.symbol}, ` +
      `but Alpaca returned no valid filled_avg_price.`
    );
  }

  const trade =
    createTrade({
      sessionId:
        session.id,

      market:
        best.symbol,

      marketName:
        best.name ||
        best.symbol,

      direction,

      conviction:
        best.score >=
        9
          ? 'high'
          : best.score >=
              8
            ? 'standard'
            : 'probe',

      entryPrice,
    });

  const exitPlan =
    best.signal
      ?.exitPlan ||
    {};

  Object.assign(
    trade,
    {
      asset_class:
        best.assetClass,

      execution_mode:
        mode,

      alpaca_order_id:
        order.id,

      entry_order_status:
        fill.status,

      entry_was_partial:
        fill.status !==
        'filled',

      // CRITICAL:
      // actual executed quantity only.
      qty:
        String(
          fill.filled_qty
        ),

      filled_qty:
        String(
          fill.filled_qty
        ),

      strategy_name:
        best.strategy,

      quality_score:
        best.score,

      atr_pct:
        exitPlan
          .atrPct ??
        null,

      stop_loss_pct:
        exitPlan
          .stopLossPct ??
        cfg()
          .fallbackStopLossPct,

      take_profit_pct:
        exitPlan
          .takeProfitPct ??
        cfg()
          .fallbackTakeProfitPct,

      trail_trigger_pct:
        exitPlan
          .trailTriggerPct ??
        null,

      trail_distance_pct:
        exitPlan
          .trailDistancePct ??
        null,

      max_hold_minutes:
        exitPlan
          .maxHoldMinutes ??
        cfg()
          .fallbackMaxHoldMinutes,

      best_favorable_move_pct:
        0,

      entry_signal: {
        strategy:
          best.strategy,

        score:
          best.score,

        components:
          best.signal
            ?.components ||
          {},

        minute_momentum_pct:
          best
            .prefilterMomentumPct ??
          null,

        trend_5m_pct:
          best.signal
            ?.trend5Pct ??
          null,

        trend_15m_pct:
          best.signal
            ?.trend15Pct ??
          null,

        recent_volume_ratio:
          best.signal
            ?.recentVolumeRatio ??
          null,

        spread_pct:
          best.signal
            ?.spreadPct ??
          null,

        vwap:
          best.signal
            ?.vwap ??
          null,

        opening_range:
          best.signal
            ?.openingRange ??
          null,

        breakout_type:
          best.signal
            ?.breakoutType ??
          null,

        breakout_level:
          best.signal
            ?.breakoutLevel ??
          null,

        vwap_distance_atr:
          best.signal
            ?.vwapDistanceAtr ??
          null,

        breakout_distance_atr:
          best.signal
            ?.breakoutDistanceAtr ??
          null,

        source:
          'alpaca snapshots + historical bars',
      },
    }
  );

  store.insert(
    'trades',
    trade
  );

  state.openTradeIds.push(
    trade.id
  );

  state.lastDecision =
    `entered ${mode.toUpperCase()} ${direction} ${best.symbol} ` +
    `qty ${filledQty} at ${entryPrice} — ${best.strategy} score ${best.score}/10` +
    (
      fill.status ===
      'filled'
        ? ''
        : ` — terminal partial fill (${fill.status})`
    ) +
    ` — ${state.openTradeIds.length}/${maxOpenPositions()} positions open`;

  return true;
}

async function tick() {
  if (
    !state.running
  ) {
    return;
  }

  const mode =
    state.mode;

  try {
    if (
      ![
        'paper',
        'live',
      ].includes(
        mode
      )
    ) {
      stop(
        'Bot mode is invalid.'
      );

      return;
    }

    const access =
      accessCheck(
        mode
      );

    if (
      !access.allowed
    ) {
      stop(
        `${mode.toUpperCase()} access closed: ${access.reason}`
      );

      return;
    }

    const currentMode =
      selectedMode();

    if (
      currentMode !==
      mode
    ) {
      stop(
        `Trading mode changed from ${mode} to ${currentMode}.`
      );

      return;
    }

    state.lastTickAt =
      new Date()
        .toISOString();

    state.lastError =
      null;

    state.exitRetryPending =
      false;

    await manageOpenTrades(
      mode
    );

    if (
      state.running &&
      !state.exitRetryPending &&
      state.openTradeIds
        .length <
        maxOpenPositions()
    ) {
      await enter(
        mode
      );
    }
  } catch (
    error
  ) {
    console.error(
      `[${mode}-bot]`,
      error
    );

    state.lastError =
      error.message;

    state.lastDecision =
      `stopped on error: ${error.message}`;

    stop(
      error.message
    );
  } finally {
    schedule();
  }
}

// ========================================
// STATUS
// ========================================

router.get(
  '/status',

  (
    req,
    res
  ) => {
    res.json(
      pub()
    );
  }
);

// ========================================
// START
// ========================================

router.post(
  '/start',

  async (
    req,
    res
  ) => {
    try {
      if (
        state.running
      ) {
        return res
          .status(
            409
          )
          .json({
            error:
              'Trading bot is already running.',

            ...pub(),
          });
      }

      const mode =
        selectedMode();

      const access =
        accessCheck(
          mode
        );

      if (
        !access.allowed
      ) {
        return res
          .status(
            403
          )
          .json({
            error:
              `${mode.toUpperCase()} bot blocked: ${access.reason}`,
          });
      }

      const account =
        await getAccount(
          mode
        );

      if (
        account
          .trading_blocked
      ) {
        return res
          .status(
            403
          )
          .json({
            error:
              `Alpaca reports trading_blocked=true for the ${mode} account.`,
          });
      }

      const brokerPositions =
        await getPositions(
          mode
        );

      const openLocalTrades =
        store
          .getAll(
            'trades'
          )
          .filter(
            (
              trade
            ) => {
              if (
                trade.result !==
                null
              ) {
                return false;
              }

              const session =
                store.getOne(
                  'sessions',
                  trade.session_id
                );

              return (
                session?.mode ===
                mode
              );
            }
          );

      // ========================================
      // RECOVER EXISTING BOT POSITIONS
      // ========================================

      if (
        openLocalTrades.length
      ) {
        for (
          const trade of
          openLocalTrades
        ) {
          const matchingPosition =
            findMatchingPosition(
              brokerPositions,
              trade.market
            );

          if (
            !matchingPosition
          ) {
            return res
              .status(
                409
              )
              .json({
                error:
                  `Local ${mode} trade ${trade.id} is marked open, but Alpaca ` +
                  `has no matching ${trade.market} position. ` +
                  `Resolve that trade before restarting the bot.`,
              });
          }
        }

        if (
          openLocalTrades.length >
          maxOpenPositions()
        ) {
          return res
            .status(
              409
            )
            .json({
              error:
                `Found ${openLocalTrades.length} open local ${mode} trades, ` +
                `but this bot allows at most ${maxOpenPositions()} positions.`,
            });
        }

        const sessionIds =
          [
            ...new Set(
              openLocalTrades.map(
                (
                  trade
                ) =>
                  trade.session_id
              )
            ),
          ];

        if (
          sessionIds.length !==
          1
        ) {
          return res
            .status(
              409
            )
            .json({
              error:
                `Open local ${mode} trades belong to multiple sessions. ` +
                `Automatic recovery is blocked.`,
            });
        }

        const existingSession =
          store.getOne(
            'sessions',
            sessionIds[0]
          );

        if (
          !existingSession
        ) {
          return res
            .status(
              409
            )
            .json({
              error:
                'Open local trades exist, but their session record is missing.',
            });
        }

        state.mode =
          mode;

        state.universe = {
          equities:
            [],

          crypto:
            [],

          refreshedAt:
            null,
        };

        state.equityCursor =
          0;

        await refreshUniverse(
          mode,
          true
        );

        store.update(
          'sessions',
          existingSession.id,
          {
            status:
              'running',

            halt_reason:
              null,

            completed_at:
              null,

            updated_at:
              new Date()
                .toISOString(),
          }
        );

        Object.assign(
          state,
          {
            running:
              true,

            mode,

            sessionId:
              existingSession.id,

            startedAt:
              new Date()
                .toISOString(),

            lastTickAt:
              null,

            lastError:
              null,

            openTradeIds:
              openLocalTrades.map(
                (
                  trade
                ) =>
                  trade.id
              ),

            exitRetryPending:
              false,

            lastDecision:
              `recovering ${openLocalTrades.length}/${maxOpenPositions()} ` +
              `${mode.toUpperCase()} positions — v17 precision active`,

            signalSnapshot:
              {},

            topCandidates:
              [],

            marketOpen:
              null,
          }
        );

        setImmediate(
          tick
        );

        return res.json(
          pub()
        );
      }

      // ========================================
      // NEW SESSION
      // ========================================

      const equity =
        Number(
          account.equity ||
          account.cash ||
          0
        );

      if (
        !Number.isFinite(
          equity
        ) ||
        equity <=
          0
      ) {
        return res
          .status(
            403
          )
          .json({
            error:
              `${mode.toUpperCase()} account has no available equity.`,
          });
      }

      state.mode =
        mode;

      state.universe = {
        equities:
          [],

        crypto:
          [],

        refreshedAt:
          null,
      };

      state.equityCursor =
        0;

      await refreshUniverse(
        mode,
        true
      );

      const session =
        createSession({
          mode,

          startingCapital:
            equity,
        });

      store.insert(
        'sessions',
        session
      );

      Object.assign(
        state,
        {
          running:
            true,

          mode,

          sessionId:
            session.id,

          startedAt:
            new Date()
              .toISOString(),

          lastTickAt:
            null,

          lastError:
            null,

          openTradeIds:
            [],

          exitRetryPending:
            false,

          lastDecision:
            `starting ${mode.toUpperCase()} v17 precision bot — loaded ` +
            `${state.universe.equities.length + state.universe.crypto.length} ` +
            `Alpaca tradable assets — up to ${maxOpenPositions()} positions`,

          signalSnapshot:
            {},

          topCandidates:
            [],

          marketOpen:
            null,
        }
      );

      setImmediate(
        tick
      );

      return res.json(
        pub()
      );
    } catch (
      error
    ) {
      console.error(
        '[bot-start]',
        error
      );

      return res
        .status(
          500
        )
        .json({
          error:
            error.message,
        });
    }
  }
);

// ========================================
// STOP
// ========================================

router.post(
  '/stop',

  async (
    req,
    res
  ) => {
    const mode =
      state.mode;

    stop();

    state.lastDecision =
      'stopped by user';

    const closeErrors =
      [];

    try {
      if (mode) {
        syncOpenTradeIds();

        for (
          const id of
          [
            ...state.openTradeIds,
          ]
        ) {
          const trade =
            store.getOne(
              'trades',
              id
            );

          if (
            !trade ||
            trade.result !==
              null
          ) {
            continue;
          }

          try {
            const assetClass =
              trade.asset_class ||
              (
                String(
                  trade.market
                ).includes(
                  '/'
                )
                  ? 'crypto'
                  : 'us_equity'
              );

            const price =
              await getLatestTradablePrice(
                mode,
                trade.market,
                assetClass
              );

            await closeTrade(
              mode,
              trade,
              price,
              'bot stopped by user'
            );
          } catch (
            error
          ) {
            closeErrors.push(
              `${trade.market}: ${error.message}`
            );
          }
        }
      }

      if (
        state.sessionId
      ) {
        const session =
          store.getOne(
            'sessions',
            state.sessionId
          );

        if (
          session &&
          session.status ===
            'running'
        ) {
          store.update(
            'sessions',
            session.id,
            {
              status:
                'halted',

              halt_reason:
                closeErrors.length
                  ? `Bot stopped; some positions failed to close: ${closeErrors.join(
                      ' | '
                    )}`
                  : 'Bot stopped by user',

              completed_at:
                new Date()
                  .toISOString(),
            }
          );
        }
      }

      syncOpenTradeIds();

      if (
        closeErrors.length
      ) {
        state.lastError =
          `Bot stopped, but ${closeErrors.length} position(s) failed to close: ` +
          closeErrors.join(
            ' | '
          );

        return res
          .status(
            500
          )
          .json({
            error:
              state.lastError,

            ...pub(),
          });
      }

      return res.json(
        pub()
      );
    } catch (
      error
    ) {
      state.lastError =
        `Bot stopped, but shutdown cleanup failed: ${error.message}`;

      return res
        .status(
          500
        )
        .json({
          error:
            state.lastError,

          ...pub(),
        });
    }
  }
);

export default router;
