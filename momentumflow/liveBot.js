import express from 'express';
import fetch from 'node-fetch';
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
  getCredentials,
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

// UNIFIED BOT v16
//
// PAPER and LIVE use the same scanner,
// scoring, entries, exits and risk rules.
//
// v16:
// - up to 3 simultaneous positions
// - staged hot-list scanner
// - equity opening-range breakout scoring
// - 5m + 15m trend confirmation
// - recent-volume confirmation
// - VWAP confirmation
// - bid/ask spread filter
// - SPY/QQQ market regime
// - late-day momentum bonus
// - crypto multi-timeframe scoring
// - BTC crypto regime
// - dynamic volatility exits
// - trailing exits
// - symbol cooldown
// - partial-fill protection
// - startup reconciliation

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

  fallbackTakeProfitPct: 0.6,

  fallbackStopLossPct: 0.4,

  fallbackMaxHoldMinutes: 15,
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
  const value = Math.trunc(
    Number(
      cfg().maxOpenPositions ??
      3
    )
  );

  if (!Number.isFinite(value)) {
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
  const mode =
    store.getConfig(
      'tradingMode',
      {
        mode: 'paper',
      }
    ).mode;

  return mode === 'live'
    ? 'live'
    : 'paper';
}

function accessCheck(mode) {
  if (mode === 'live') {
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

  if (!hasCredentials('paper')) {
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
    running: state.running,

    mode: state.mode,

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

    openTradeIds: [
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
        state.mode === 'paper'
          ? 'ALPACA_PAPER'
          : state.mode === 'live'
            ? 'ALPACA_LIVE'
            : null,
    },

    strategyConfig:
      strategyCfg(),
  };
}

function stop(reason = null) {
  if (state.timer) {
    clearTimeout(
      state.timer
    );
  }

  state.timer = null;
  state.running = false;

  if (reason) {
    state.lastError =
      reason;
  }
}

function schedule() {
  if (!state.running) {
    return;
  }

  state.timer =
    setTimeout(
      tick,

      Math.max(
        2,
        Number(
          cfg().pollSeconds
        )
      ) * 1000
    );
}

function normPos(symbol = '') {
  const value =
    String(
      symbol ||
      ''
    ).toUpperCase();

  if (value.includes('/')) {
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
  if (value == null) {
    return null;
  }

  const raw =
    String(
      value
    ).trim();

  if (!raw) {
    return null;
  }

  return raw.startsWith('-')
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
      (position) => {
        const qty =
          Math.abs(
            Number(
              position?.qty ||
              0
            )
          );

        return (
          qty > 0 &&
          normPos(
            position?.symbol
          ) === wanted
        );
      }
    ) ||
    null
  );
}

function getSessionOpenTrades() {
  if (!state.sessionId) {
    return [];
  }

  return store
    .getAll('trades')
    .filter(
      (trade) =>
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
        (trade) =>
          trade.id
      );

  return state.openTradeIds;
}

async function refreshUniverse(
  mode,
  force = false
) {
  const c = cfg();

  const age =
    state.universe.refreshedAt
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
    state.equityCursor = 0;
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
          (position) =>
            Math.abs(
              Number(
                position.qty ||
                0
              )
            ) >
            0
        )
        .map(
          (position) =>
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
        cfg().equityBatchSize
      ),

      state.universe
        .equities.length
    );

  const batch = [];

  for (
    let i = 0;
    i < count;
    i++
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
      ) * 2
    )
  );
}

async function scan(mode) {
  await refreshUniverse(
    mode
  );

  const c = cfg();
  const sc = strategyCfg();

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
      .getAll('trades')
      .filter(
        (trade) =>
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
        (asset) =>
          asset.symbol
      )
      .filter(Boolean);

  if (
    cryptoSymbols.length
  ) {
    const snapshots =
      await getCryptoSnapshots(
        mode,
        cryptoSymbols
      );

    const pre = [];

    for (
      const asset of
      state.universe.crypto
    ) {
      const snapshot =
        snapshots[
          asset.symbol
        ] ||
        snapshots[
          String(
            asset.symbol ||
            ''
          ).replace(
            '/',
            ''
          )
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
            sc.cryptoCooldownMinutes
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
                  .toFixed(4)
              ),

        spreadPct:
          spread == null
            ? null
            : Number(
                spread
                  .toFixed(4)
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
            sc.maxCryptoSpreadPct
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
      (a, b) =>
        b.momentum -
        a.momentum
    );

    const shortlist =
      pre.slice(
        0,

        Math.max(
          1,
          Number(
            sc.maxDetailedCrypto
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
              (item) =>
                item.asset.symbol
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
                70 *
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
                item.asset.symbol
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
              .toFixed(4)
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
          (asset) =>
            asset.symbol
        ),

        {
          feed:
            c.stockFeed,
        }
      );

    const pre = [];

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
          c.minDailyDollarVolume
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
            sc.equityCooldownMinutes
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
                  .toFixed(4)
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
                  .toFixed(4)
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

      const longPrefilter =
        momentum >=
        Number(
          sc
            .equityPrefilterMomentumPct
        );

      const shortPrefilter =
        momentum <=
          -Number(
            sc
              .equityPrefilterMomentumPct
          ) &&
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
            sc.maxEquitySpreadPct
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
      (a, b) =>
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
            sc.maxDetailedEquities
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
              (item) =>
                item.asset.symbol
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
          barsBySymbol.SPY ||
          [],

          barsBySymbol.QQQ ||
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
                item.asset.symbol
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
              .toFixed(4)
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
    (a, b) =>
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
      ).slice(-30)
    );

  state.topCandidates =
    finalCandidates
      .slice(0, 10)
      .map(
        (candidate) => ({
          symbol:
            candidate.symbol,

          assetClass:
            candidate.assetClass,

          direction:
            candidate.direction,

          strategy:
            candidate.strategy,

          score:
            candidate.score,

          price:
            Number(
              candidate.price
                .toFixed(8)
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
        })
      );

  return (
    finalCandidates[0] ||
    null
  );
}

function saveTradePatch(
  tradeId,
  patch
) {
  const allTrades =
    store.getAll(
      'trades'
    );

  const index =
    allTrades.findIndex(
      (item) =>
        item.id ===
        tradeId
    );

  if (index < 0) {
    throw new Error(
      `Trade ${tradeId} was not found.`
    );
  }

  allTrades[index] = {
    ...allTrades[index],
    ...patch,
  };

  store.saveAll(
    'trades',
    allTrades
  );

  return allTrades[index];
}

function getExitProgress(
  trade
) {
  return {
    qty:
      Number(
        trade.partial_exit_qty ||
        0
      ),

    value:
      Number(
        trade.partial_exit_value ||
        0
      ),

    orderIds:
      Array.isArray(
        trade
          .partial_exit_order_ids
      )
        ? [
            ...trade
              .partial_exit_order_ids,
          ]
        : [],
  };
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

async function settleExitOrder(
  mode,
  orderId
) {
  let order =
    await waitForFill(
      mode,
      orderId,
      {
        timeoutMs:
          15000,

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
      cancelError
    ) {
      console.warn(
        `[${mode}-bot] exit cancel ${orderId}: ${cancelError.message}`
      );
    }

    order =
      await waitForFill(
        mode,
        orderId,
        {
          timeoutMs:
            5000,

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

function recordExitOrderProgress(
  trade,
  order
) {
  const latest =
    store.getOne(
      'trades',
      trade.id
    ) ||
    trade;

  const progress =
    getExitProgress(
      latest
    );

  const orderId =
    String(
      order?.id ||
      ''
    );

  if (!orderId) {
    throw new Error(
      `Exit order for ${trade.market} has no order id.`
    );
  }

  if (
    progress.orderIds
      .includes(
        orderId
      )
  ) {
    return latest;
  }

  const fillQty =
    Number(
      order?.filled_qty ||
      0
    );

  const fillPrice =
    Number(
      order
        ?.filled_avg_price
    );

  const patch = {
    pending_exit_order_id:
      null,

    last_exit_order_status:
      order?.status ||
      null,
  };

  if (fillQty > 0) {
    if (
      !Number.isFinite(
        fillPrice
      ) ||
      fillPrice <= 0
    ) {
      throw new Error(
        `Exit order ${orderId} filled ${fillQty} but has no valid filled_avg_price.`
      );
    }

    patch.partial_exit_qty =
      Number(
        (
          progress.qty +
          fillQty
        ).toFixed(12)
      );

    patch.partial_exit_value =
      progress.value +
      fillQty *
        fillPrice;

    patch.partial_exit_order_ids =
      [
        ...progress.orderIds,
        orderId,
      ];
  }

  return saveTradePatch(
    trade.id,
    patch
  );
}

function finalizeTradeClosure(
  mode,
  trade,
  {
    exitQty,
    exitValue,
    reason,
    exitOrderId,
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
    !Number.isFinite(qty) ||
    qty <= 0 ||
    !Number.isFinite(value) ||
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

  const direction =
    trade.direction ===
    'SHORT'
      ? 'SHORT'
      : 'LONG';

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

  const allTrades =
    store.getAll(
      'trades'
    );

  const index =
    allTrades.findIndex(
      (item) =>
        item.id ===
        trade.id
    );

  if (index < 0) {
    throw new Error(
      `Trade ${trade.id} was not found during exit finalization.`
    );
  }

  const current =
    allTrades[index];

  const progress =
    getExitProgress(
      current
    );

  allTrades[index] = {
    ...current,

    exit_price:
      exitPrice,

    pnl:
      Number(
        pnl.toFixed(4)
      ),

    result,

    exit_reason:
      reason,

    exit_order_id:
      exitOrderId ||
      progress.orderIds[
        progress.orderIds
          .length -
        1
      ] ||
      current
        .pending_exit_order_id ||
      null,

    exit_order_ids:
      progress.orderIds,

    exit_qty:
      qty,

    pending_exit_order_id:
      null,

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
    allTrades
  );

  const session =
    store.getOne(
      'sessions',
      trade.session_id
    );

  if (session) {
    session.consecutive_losses =
      result === 'loss'
        ? Number(
            session
              .consecutive_losses ||
            0
          ) + 1
        : 0;

    recomputeSessionStats(
      session,
      allTrades
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
        (id) =>
          id !== trade.id
      );

  state.exitRetryPending =
    false;

  state.lastDecision =
    `closed ${mode.toUpperCase()} ${direction} ${trade.market} ` +
    `qty ${qty} at ${exitPrice} — ${reason}`;

  return true;
}

function tradingBaseUrl(mode) {
  return (
    (
      mode === 'live'
        ? process.env
            .ALPACA_LIVE_BASE_URL
        : process.env
            .ALPACA_PAPER_BASE_URL
    ) ||
    (
      mode === 'live'
        ? 'https://api.alpaca.markets'
        : 'https://paper-api.alpaca.markets'
    )
  );
}

async function getRecentExitOrders(
  mode,
  {
    after,
    symbol,
    side,
    limit = 100,
  }
) {
  const creds =
    getCredentials(
      mode
    );

  if (!creds) {
    throw new Error(
      `No ${mode} Alpaca credentials configured.`
    );
  }

  const query =
    new URLSearchParams({
      status:
        'all',

      limit:
        String(
          Math.max(
            1,
            Math.min(
              500,
              Number(limit) ||
              100
            )
          )
        ),

      direction:
        'asc',
    });

  if (after) {
    query.set(
      'after',
      String(after)
    );
  }

  if (side) {
    query.set(
      'side',
      String(side)
    );
  }

  if (symbol) {
    query.set(
      'symbols',
      String(symbol)
        .replace(
          '/',
          ''
        )
    );
  }

  const response =
    await fetch(
      `${tradingBaseUrl(
        mode
      )}/v2/orders?${query.toString()}`,
      {
        headers: {
          'APCA-API-KEY-ID':
            creds.keyId,

          'APCA-API-SECRET-KEY':
            creds.secretKey,
        },
      }
    );

  const data =
    await response
      .json()
      .catch(
        () => []
      );

  if (!response.ok) {
    throw new Error(
      `Alpaca orders query failed (${response.status}): ${
        data?.message ||
        response.statusText
      }`
    );
  }

  return Array.isArray(data)
    ? data
    : [];
}

async function tryPendingExitRecovery(
  mode,
  trade,
  reason
) {
  const latest =
    store.getOne(
      'trades',
      trade.id
    ) ||
    trade;

  const pendingOrderId =
    latest
      .pending_exit_order_id;

  if (!pendingOrderId) {
    return latest;
  }

  const settled =
    await settleExitOrder(
      mode,
      pendingOrderId
    );

  const updated =
    recordExitOrderProgress(
      latest,
      settled
    );

  const positions =
    await getPositions(
      mode
    );

  const position =
    findMatchingPosition(
      positions,
      trade.market
    );

  const progress =
    getExitProgress(
      updated
    );

  if (
    !position &&
    progress.qty > 0
  ) {
    return finalizeTradeClosure(
      mode,
      updated,
      {
        exitQty:
          progress.qty,

        exitValue:
          progress.value,

        reason:
          `${reason} — reconciled pending Alpaca exit`,

        exitOrderId:
          pendingOrderId,

        reconciled:
          true,
      }
    );
  }

  return updated;
}

async function reconcileMissingPositionFromOrderHistory(
  mode,
  trade
) {
  let latest =
    store.getOne(
      'trades',
      trade.id
    ) ||
    trade;

  if (
    latest
      .pending_exit_order_id
  ) {
    const recovered =
      await tryPendingExitRecovery(
        mode,
        latest,
        'restart recovery'
      );

    if (
      recovered === true
    ) {
      return true;
    }

    latest =
      store.getOne(
        'trades',
        trade.id
      ) ||
      latest;

    const positions =
      await getPositions(
        mode
      );

    if (
      findMatchingPosition(
        positions,
        trade.market
      )
    ) {
      return false;
    }
  }

  const direction =
    latest.direction ===
    'SHORT'
      ? 'SHORT'
      : 'LONG';

  const exitSide =
    direction ===
    'SHORT'
      ? 'buy'
      : 'sell';

  const after =
    latest.timestamp ||
    latest.created_at;

  if (!after) {
    return false;
  }

  const orders =
    await getRecentExitOrders(
      mode,
      {
        after,

        symbol:
          latest.market,

        side:
          exitSide,

        limit:
          100,
      }
    );

  const candidates =
    orders.filter(
      (order) => {
        if (
          !order ||
          order.id ===
            latest
              .alpaca_order_id
        ) {
          return false;
        }

        if (
          normPos(
            order.symbol
          ) !==
          normPos(
            latest.market
          )
        ) {
          return false;
        }

        if (
          String(
            order.side ||
            ''
          ).toLowerCase() !==
          exitSide
        ) {
          return false;
        }

        const fillQty =
          Number(
            order.filled_qty ||
            0
          );

        const fillPrice =
          Number(
            order
              .filled_avg_price
          );

        return (
          fillQty > 0 &&
          Number.isFinite(
            fillPrice
          ) &&
          fillPrice > 0
        );
      }
    );

  if (
    candidates.length !== 1
  ) {
    return false;
  }

  let candidate =
    candidates[0];

  if (
    isOrderStillOpen(
      candidate.status
    )
  ) {
    candidate =
      await settleExitOrder(
        mode,
        candidate.id
      );
  }

  latest =
    recordExitOrderProgress(
      latest,
      candidate
    );

  const positions =
    await getPositions(
      mode
    );

  if (
    findMatchingPosition(
      positions,
      latest.market
    )
  ) {
    return false;
  }

  const progress =
    getExitProgress(
      latest
    );

  const recordedQty =
    Number(
      positiveQtyString(
        latest.filled_qty ??
        latest.qty
      )
    );

  if (
    !Number.isFinite(
      recordedQty
    ) ||
    recordedQty <= 0 ||
    progress.qty <= 0
  ) {
    return false;
  }

  const fillRatio =
    progress.qty /
    recordedQty;

  if (
    fillRatio < 0.90 ||
    fillRatio > 1.10
  ) {
    return false;
  }

  finalizeTradeClosure(
    mode,
    latest,
    {
      exitQty:
        progress.qty,

      exitValue:
        progress.value,

      reason:
        'reconciled from Alpaca exit-order history after restart',

      exitOrderId:
        candidate.id,

      reconciled:
        true,
    }
  );

  return true;
}

async function closeTrade(
  mode,
  trade,
  price,
  reason
) {
  let latest =
    store.getOne(
      'trades',
      trade.id
    ) ||
    trade;

  const recordedQty =
    Number(
      positiveQtyString(
        latest.filled_qty ??
        latest.qty
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
    latest.direction ===
    'SHORT'
      ? 'SHORT'
      : 'LONG';

  const crypto =
    latest.asset_class ===
      'crypto' ||
    String(
      latest.market
    ).includes('/');

  if (
    latest
      .pending_exit_order_id
  ) {
    const recovered =
      await tryPendingExitRecovery(
        mode,
        latest,
        reason
      );

    if (
      recovered === true
    ) {
      return true;
    }

    latest =
      store.getOne(
        'trades',
        trade.id
      ) ||
      latest;
  }

  for (
    let attempt = 1;
    attempt <= 3;
    attempt++
  ) {
    const positions =
      await getPositions(
        mode
      );

    const position =
      findMatchingPosition(
        positions,
        latest.market
      );

    const progress =
      getExitProgress(
        latest
      );

    const alreadyExited =
      Number(
        progress.qty ||
        0
      );

    const remainingRecorded =
      Math.max(
        0,
        recordedQty -
          alreadyExited
      );

    const tinyTolerance =
      Math.max(
        recordedQty *
          0.002,
        1e-12
      );

    if (
      remainingRecorded <=
        tinyTolerance &&
      progress.qty > 0
    ) {
      return finalizeTradeClosure(
        mode,
        latest,
        {
          exitQty:
            progress.qty,

          exitValue:
            progress.value,

          reason,

          reconciled:
            attempt > 1,
        }
      );
    }

    if (!position) {
      if (
        progress.qty > 0
      ) {
        return finalizeTradeClosure(
          mode,
          latest,
          {
            exitQty:
              progress.qty,

            exitValue:
              progress.value,

            reason,

            reconciled:
              attempt > 1,
          }
        );
      }

      throw new Error(
        `No matching Alpaca ${mode} position exists for ${latest.market}. ` +
        `Local trade ${latest.id} is still marked open and needs reconciliation.`
      );
    }

    const availableQtyString =
      positiveQtyString(
        position.qty_available ??
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
        `Alpaca reports no available quantity to close for ${latest.market}.`
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
        `Invalid close quantity for ${latest.market}.`
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
                .toFixed(12)
            )
          );

    const exitSide =
      direction ===
      'SHORT'
        ? 'buy'
        : 'sell';

    state.lastDecision =
      `closing ${mode.toUpperCase()} ${direction} ${latest.market} ` +
      `qty ${closeQtyString} — ${reason} — attempt ${attempt}/3`;

    const order =
      await placeOrder({
        mode,

        symbol:
          latest.market,

        qty:
          closeQtyString,

        side:
          exitSide,

        type:
          'market',

        timeInForce:
          crypto
            ? 'gtc'
            : 'day',
      });

    latest =
      saveTradePatch(
        latest.id,
        {
          pending_exit_order_id:
            order.id,

          pending_exit_reason:
            reason,

          pending_exit_started_at:
            new Date()
              .toISOString(),
        }
      );

    const settled =
      await settleExitOrder(
        mode,
        order.id
      );

    latest =
      recordExitOrderProgress(
        latest,
        settled
      );

    if (
      isOrderStillOpen(
        settled.status
      )
    ) {
      throw new Error(
        `Exit order ${order.id} is still ${settled.status} after cancel/recheck. ` +
        `Bot stopped to avoid submitting a duplicate exit.`
      );
    }

    const updatedProgress =
      getExitProgress(
        latest
      );

    const botRemaining =
      Math.max(
        0,
        recordedQty -
          updatedProgress.qty
      );

    if (
      botRemaining <=
        tinyTolerance &&
      updatedProgress.qty >
        0
    ) {
      return finalizeTradeClosure(
        mode,
        latest,
        {
          exitQty:
            updatedProgress.qty,

          exitValue:
            updatedProgress.value,

          reason,

          exitOrderId:
            order.id,

          reconciled:
            attempt > 1 ||
            settled.status !==
              'filled',
        }
      );
    }

    const afterPositions =
      await getPositions(
        mode
      );

    const remainingPosition =
      findMatchingPosition(
        afterPositions,
        latest.market
      );

    if (
      !remainingPosition
    ) {
      if (
        updatedProgress.qty <=
        0
      ) {
        throw new Error(
          `Alpaca no longer shows ${latest.market}, but exit order ${order.id} ` +
          `reported no executed quantity. Reconciliation is required.`
        );
      }

      return finalizeTradeClosure(
        mode,
        latest,
        {
          exitQty:
            updatedProgress.qty,

          exitValue:
            updatedProgress.value,

          reason,

          exitOrderId:
            order.id,

          reconciled:
            attempt > 1 ||
            settled.status !==
              'filled',
        }
      );
    }

    if (
      Number(
        settled.filled_qty ||
        0
      ) <= 0 &&
      [
        'rejected',
        'expired',
      ].includes(
        settled.status
      )
    ) {
      throw new Error(
        `Exit order ${order.id} ${settled.status} without a fill for ${latest.market}.`
      );
    }
  }

  state.exitRetryPending =
    true;

  state.lastDecision =
    `partial exit remains for ${latest.market}; no new entries until next retry`;

  return false;
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
      ).includes('/')
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

  const c = cfg();

  const takeProfitPct =
    Number(
      trade.take_profit_pct ??
      c.fallbackTakeProfitPct
    );

  const stopLossPct =
    Number(
      trade.stop_loss_pct ??
      c.fallbackStopLossPct
    );

  const trailTriggerPct =
    Number(
      trade.trail_trigger_pct ??
      Infinity
    );

  const trailDistancePct =
    Number(
      trade.trail_distance_pct ??
      Infinity
    );

  const maxHoldMinutes =
    Number(
      trade.max_hold_minutes ??
      c.fallbackMaxHoldMinutes
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
            bestMove.toFixed(4)
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
    const closed =
      await closeTrade(
        mode,
        trade,
        price,

        `${direction} dynamic take profit +${favorableMove.toFixed(
          3
        )}%`
      );

    return closed
      ? 'closed'
      : 'open';
  }

  if (
    favorableMove <=
    -stopLossPct
  ) {
    const closed =
      await closeTrade(
        mode,
        trade,
        price,

        `${direction} dynamic stop loss ${favorableMove.toFixed(
          3
        )}%`
      );

    return closed
      ? 'closed'
      : 'open';
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
    const closed =
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

    return closed
      ? 'closed'
      : 'open';
  }

  if (
    ageMinutes >=
    maxHoldMinutes
  ) {
    const closed =
      await closeTrade(
        mode,
        trade,
        price,

        `${direction} max hold ${ageMinutes.toFixed(
          1
        )}m`
      );

    return closed
      ? 'closed'
      : 'open';
  }

  return 'open';
}

async function manageOpenTrades(
  mode
) {
  syncOpenTradeIds();

  if (
    !state.openTradeIds
      .length
  ) {
    return 0;
  }

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
            (tradeId) =>
              tradeId !== id
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

async function enter(mode) {
  syncOpenTradeIds();

  if (
    state.openTradeIds.length >=
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

  if (halt.halt) {
    if (
      state.openTradeIds.length >
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
      `${maxOpenPositions()} positions open — waiting for score-qualified setup`;

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
      account.buying_power ||
      account.cash ||
      0
    );

  const equity =
    Number(
      account.equity ||
      account.portfolio_value ||
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
    riskFraction <= 0 ||
    riskFraction > 1
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
    positionBudget < 1
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

    if (qty < 1) {
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

    if (qty < 1) {
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
              .toFixed(2)
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

  const fill =
    await waitForFill(
      mode,
      order.id
    );

  if (
    fill.status !==
    'filled'
  ) {
    throw new Error(
      `Entry order ${order.id} was not filled (status: ${fill.status}).`
    );
  }

  const entryPrice =
    Number(
      fill.filled_avg_price ||
      best.price
    );

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
        best.score >= 9
          ? 'high'
          : best.score >= 8
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

      qty:
        fill.filled_qty,

      filled_qty:
        fill.filled_qty,

      strategy_name:
        best.strategy,

      quality_score:
        best.score,

      atr_pct:
        exitPlan.atrPct ??
        null,

      stop_loss_pct:
        exitPlan.stopLossPct ??
        cfg()
          .fallbackStopLossPct,

      take_profit_pct:
        exitPlan.takeProfitPct ??
        cfg()
          .fallbackTakeProfitPct,

      trail_trigger_pct:
        exitPlan.trailTriggerPct ??
        null,

      trail_distance_pct:
        exitPlan.trailDistancePct ??
        null,

      max_hold_minutes:
        exitPlan.maxHoldMinutes ??
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
    `entered ${mode.toUpperCase()} ${direction} ${best.symbol} at ` +
    `${entryPrice} — ${best.strategy} score ${best.score}/10 — ` +
    `${state.openTradeIds.length}/${maxOpenPositions()} positions open`;

  return true;
}

async function tick() {
  if (!state.running) {
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

    if (!access.allowed) {
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
      state.openTradeIds.length <
        maxOpenPositions()
    ) {
      await enter(
        mode
      );
    }
  } catch (error) {
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
  (req, res) => {
    res.json(
      pub()
    );
  }
);

// ========================================
// START + RECOVERY
// ========================================

router.post(
  '/start',

  async (
    req,
    res
  ) => {
    try {
      if (state.running) {
        return res
          .status(409)
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

      if (!access.allowed) {
        return res
          .status(403)
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
        account.trading_blocked
      ) {
        return res
          .status(403)
          .json({
            error:
              `Alpaca reports trading_blocked=true for the ${mode} account.`,
          });
      }

      const brokerPositions =
        await getPositions(
          mode
        );

      let openLocalTrades =
        store
          .getAll('trades')
          .filter(
            (trade) => {
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

      if (
        openLocalTrades.length
      ) {
        for (
          const trade of
          [
            ...openLocalTrades,
          ]
        ) {
          const matchingPosition =
            findMatchingPosition(
              brokerPositions,
              trade.market
            );

          if (!matchingPosition) {
            const repaired =
              await reconcileMissingPositionFromOrderHistory(
                mode,
                trade
              );

            if (!repaired) {
              return res
                .status(409)
                .json({
                  error:
                    `Local ${mode} trade ${trade.id} is marked open, but Alpaca ` +
                    `has no matching ${trade.market} position. Automatic order-history ` +
                    `reconciliation was not unambiguous, so manual reconciliation is required.`,
                });
            }
          }
        }

        openLocalTrades =
          openLocalTrades
            .filter(
              (trade) => {
                const current =
                  store.getOne(
                    'trades',
                    trade.id
                  );

                return (
                  current?.result ===
                  null
                );
              }
            );

        if (
          openLocalTrades.length >
          maxOpenPositions()
        ) {
          return res
            .status(409)
            .json({
              error:
                `Found ${openLocalTrades.length} open local ${mode} trades, ` +
                `but this bot is configured for at most ${maxOpenPositions()} positions.`,
            });
        }

        if (
          openLocalTrades.length
        ) {
          const sessionIds =
            [
              ...new Set(
                openLocalTrades.map(
                  (trade) =>
                    trade.session_id
                )
              ),
            ];

          if (
            sessionIds.length !==
            1
          ) {
            return res
              .status(409)
              .json({
                error:
                  `Open local ${mode} trades belong to multiple sessions. ` +
                  `Automatic recovery is blocked to avoid mixing session P&L.`,
              });
          }

          const existingSession =
            store.getOne(
              'sessions',
              sessionIds[0]
            );

          if (!existingSession) {
            return res
              .status(409)
              .json({
                error:
                  'Open local trades exist, but their session record is missing.',
              });
          }

          state.mode =
            mode;

          state.universe = {
            equities: [],
            crypto: [],
            refreshedAt: null,
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
                  (trade) =>
                    trade.id
                ),

              exitRetryPending:
                false,

              lastDecision:
                `recovering ${openLocalTrades.length}/${maxOpenPositions()} ` +
                `${mode.toUpperCase()} bot positions — v16 strategy active for new entries`,

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
        equity <= 0
      ) {
        return res
          .status(403)
          .json({
            error:
              `${mode.toUpperCase()} account has no available equity.`,
          });
      }

      state.mode =
        mode;

      state.universe = {
        equities: [],
        crypto: [],
        refreshedAt: null,
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
            `starting ${mode.toUpperCase()} v16 score bot — loaded ` +
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
    } catch (error) {
      console.error(
        '[bot-start]',
        error
      );

      return res
        .status(500)
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
                ).includes('/')
                  ? 'crypto'
                  : 'us_equity'
              );

            const price =
              await getLatestTradablePrice(
                mode,
                trade.market,
                assetClass
              );

            const closed =
              await closeTrade(
                mode,
                trade,
                price,
                'bot stopped by user'
              );

            if (!closed) {
              closeErrors.push(
                `${trade.market}: exit remained partially filled after retry limit`
              );
            }
          } catch (error) {
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
                closeErrors.length >
                0
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
          .status(500)
          .json({
            error:
              state.lastError,

            ...pub(),
          });
      }

      return res.json(
        pub()
      );
    } catch (error) {
      state.lastError =
        `Bot stopped, but shutdown cleanup failed: ${error.message}`;

      return res
        .status(500)
        .json({
          error:
            state.lastError,

          ...pub(),
        });
    }
  }
);

export default router;
