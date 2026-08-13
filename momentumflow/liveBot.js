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
  getLatestTradablePrice,
  getCredentials,
  hasCredentials,
  placeOrder,
  getOrder,
  cancelOrder,
  waitForFill,
} from './alpacaClient.js';

// UNIFIED BOT v15
//
// PAPER = Alpaca market data + Alpaca paper orders
// LIVE  = same strategy + Alpaca live orders
//
// Equities = LONG + SHORT
// Crypto   = LONG only
//
// v15:
// - 3 simultaneous positions
// - handles partial exit fills
// - cancels partial-order remainder before retry
// - retries actual remaining broker quantity
// - saves partial fills
// - startup orphan reconciliation from Alpaca order history
// - preserves qty_available crypto exit fix

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

  entryMomentumPct: 0.15,

  takeProfitPct: 0.6,
  stopLossPct: 0.4,

  maxHoldMinutes: 15,

  maxOpenPositions: 3,

  equityBatchSize: 75,

  universeRefreshMinutes: 15,

  minEquityPrice: 1,

  minDailyDollarVolume: 1000000,

  stockFeed: 'iex',
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

function accessCheck(
  mode
) {
  if (
    mode === 'live'
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

    // Keeps current Dashboard compatible.
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
        state.mode === 'paper'
          ? 'ALPACA_PAPER'
          : state.mode === 'live'
            ? 'ALPACA_LIVE'
            : null,
    },
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

  if (
    reason
  ) {
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

function normPos(
  symbol = ''
) {
  const value =
    String(
      symbol ||
      ''
    ).toUpperCase();

  if (
    value.includes('/')
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

  return raw.startsWith('-')
    ? raw.slice(1)
    : raw;
}

function tradingBaseUrl(
  mode
) {
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

  if (
    after
  ) {
    query.set(
      'after',
      String(
        after
      )
    );
  }

  if (
    side
  ) {
    query.set(
      'side',
      String(
        side
      )
    );
  }

  if (
    symbol
  ) {
    query.set(
      'symbols',
      String(
        symbol
      ).replace(
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

  if (
    !response.ok
  ) {
    throw new Error(
      `Alpaca orders query failed (${response.status}): ` +
      `${
        data?.message ||
        response.statusText
      }`
    );
  }

  return Array.isArray(
    data
  )
    ? data
    : [];
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

  return state
    .openTradeIds;
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
      new Date().toISOString(),
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

function momentum(
  snapshot
) {
  const bar =
    snapshot?.minuteBar;

  const open =
    Number(
      bar?.o
    );

  const close =
    Number(
      bar?.c ??
      snapshot
        ?.latestTrade
        ?.p
    );

  if (
    !Number.isFinite(
      open
    ) ||
    !Number.isFinite(
      close
    ) ||
    open <= 0
  ) {
    return null;
  }

  return {
    momentumPct:
      (
        (
          close -
          open
        ) /
        open
      ) *
      100,

    price:
      close,

    volume:
      Number(
        snapshot
          ?.dailyBar
          ?.v ||
        0
      ),
  };
}

async function scan(
  mode
) {
  await refreshUniverse(
    mode
  );

  const c =
    cfg();

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
    new Set(
      positions
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
    trades
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

  const candidates =
    [];

  const snapshotOutput =
    {};

  // ========================================
  // CRYPTO
  // LONG ONLY
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

    for (
      const asset of
      state.universe
        .crypto
    ) {
      const snapshot =
        snapshots[
          asset.symbol
        ] ||
        snapshots[
          asset.symbol
            ?.replace(
              '/',
              ''
            )
        ];

      const m =
        momentum(
          snapshot
        );

      if (!m) {
        continue;
      }

      const eligible =
        !blocked.has(
          normPos(
            asset.symbol
          )
        ) &&
        canTradeMarket(
          trades,
          asset.symbol
        );

      snapshotOutput[
        asset.symbol
      ] = {
        assetClass:
          'crypto',

        direction:
          'LONG',

        momentumPct:
          Number(
            m.momentumPct
              .toFixed(4)
          ),

        thresholdPct:
          Number(
            c.entryMomentumPct
          ),

        eligible,
      };

      if (
        eligible &&
        m.momentumPct >=
          Number(
            c.entryMomentumPct
          )
      ) {
        candidates.push({
          symbol:
            asset.symbol,

          name:
            asset.name ||
            asset.symbol,

          assetClass:
            'crypto',

          direction:
            'LONG',

          score:
            Math.abs(
              m.momentumPct
            ),

          ...m,
        });
      }
    }
  }

  // ========================================
  // EQUITIES
  // LONG + SHORT
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
    const count =
      Math.min(
        Number(
          c.equityBatchSize
        ),

        state.universe
          .equities.length
      );

    const batch =
      [];

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

    for (
      const asset of
      batch
    ) {
      const m =
        momentum(
          snapshots[
            asset.symbol
          ]
        );

      if (!m) {
        continue;
      }

      if (
        m.price <
        Number(
          c.minEquityPrice
        )
      ) {
        continue;
      }

      const dollarVolume =
        m.price *
        m.volume;

      const baseEligible =
        dollarVolume >=
          Number(
            c.minDailyDollarVolume
          ) &&
        !blocked.has(
          normPos(
            asset.symbol
          )
        ) &&
        canTradeMarket(
          trades,
          asset.symbol
        );

      const shortEligible =
        baseEligible &&
        asset.shortable ===
          true &&
        asset.easy_to_borrow ===
          true;

      let direction =
        null;

      if (
        baseEligible &&
        m.momentumPct >=
          Number(
            c.entryMomentumPct
          )
      ) {
        direction =
          'LONG';
      } else if (
        shortEligible &&
        m.momentumPct <=
          -Number(
            c.entryMomentumPct
          )
      ) {
        direction =
          'SHORT';
      }

      snapshotOutput[
        asset.symbol
      ] = {
        assetClass:
          'us_equity',

        momentumPct:
          Number(
            m.momentumPct
              .toFixed(4)
          ),

        thresholdPct:
          Number(
            c.entryMomentumPct
          ),

        eligible:
          baseEligible,

        shortable:
          asset.shortable ===
          true,

        easyToBorrow:
          asset.easy_to_borrow ===
          true,

        direction,

        dollarVolume:
          Math.round(
            dollarVolume
          ),
      };

      if (
        direction
      ) {
        candidates.push({
          symbol:
            asset.symbol,

          name:
            asset.name ||
            asset.symbol,

          assetClass:
            'us_equity',

          direction,

          score:
            Math.abs(
              m.momentumPct
            ),

          dollarVolume,

          ...m,
        });
      }
    }
  }

  candidates.sort(
    (
      a,
      b
    ) =>
      b.score -
      a.score
  );

  state.signalSnapshot =
    Object.fromEntries(
      Object.entries(
        snapshotOutput
      ).slice(
        -25
      )
    );

  state.topCandidates =
    candidates
      .slice(
        0,
        10
      )
      .map(
        (
          candidate
        ) => ({
          symbol:
            candidate.symbol,

          assetClass:
            candidate.assetClass,

          direction:
            candidate.direction,

          momentumPct:
            Number(
              candidate
                .momentumPct
                .toFixed(4)
            ),

          price:
            Number(
              candidate
                .price
                .toFixed(6)
            ),
        })
      );

  return (
    candidates[0] ||
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
      (
        item
      ) =>
        item.id ===
        tradeId
    );

  if (
    index < 0
  ) {
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

  return allTrades[
    index
  ];
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
        trade.partial_exit_order_ids
      )
        ? [
            ...trade.partial_exit_order_ids,
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
    /*
     * Important:
     *
     * A crypto GTC exit can partially fill
     * and continue filling after our wait.
     *
     * Cancel the remaining quantity before
     * submitting another exit.
     */

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

  if (
    !orderId
  ) {
    throw new Error(
      `Exit order for ${trade.market} has no order id.`
    );
  }

  if (
    progress.orderIds.includes(
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
        `Exit order ${orderId} filled ${fillQty} but has no valid filled_avg_price.`
      );
    }

    patch.partial_exit_qty =
      Number(
        (
          progress.qty +
          fillQty
        ).toFixed(
          12
        )
      );

    patch.partial_exit_value =
      progress.value +
      (
        fillQty *
        fillPrice
      );

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

  let allTrades =
    store.getAll(
      'trades'
    );

  const index =
    allTrades.findIndex(
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

  const current =
    allTrades[
      index
    ];

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
        pnl.toFixed(
          4
        )
      ),

    result,

    exit_reason:
      reason,

    exit_order_id:
      exitOrderId ||
      progress.orderIds[
        progress.orderIds.length -
        1
      ] ||
      current.pending_exit_order_id ||
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
      new Date().toISOString(),
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

  if (
    session
  ) {
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
    latest.pending_exit_order_id;

  if (
    !pendingOrderId
  ) {
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
    progress.qty >
      0
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

  /*
   * If a prior process stopped while an
   * exit was pending, reconcile that exact
   * order first.
   */

  if (
    latest.pending_exit_order_id
  ) {
    const recovered =
      await tryPendingExitRecovery(
        mode,
        latest,
        'restart recovery'
      );

    if (
      recovered ===
      true
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

  if (
    !after
  ) {
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
    (
      Array.isArray(
        orders
      )
        ? orders
        : []
    ).filter(
      (
        order
      ) => {
        if (
          !order ||
          order.id ===
            latest.alpaca_order_id
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

  /*
   * Only auto-repair when we have exactly
   * one possible matching exit.
   *
   * Anything ambiguous remains blocked
   * instead of guessing.
   */

  if (
    candidates.length !==
    1
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

  /*
   * Allows minor crypto fee/precision
   * differences, but refuses a large
   * mismatch.
   */

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

  /*
   * If the process restarted while an
   * exit order was still active, finish
   * that order before submitting another.
   */

  if (
    latest.pending_exit_order_id
  ) {
    const recovered =
      await tryPendingExitRecovery(
        mode,
        latest,
        reason
      );

    if (
      recovered ===
      true
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

  /*
   * Up to 3 exit attempts.
   *
   * Each retry uses the exact quantity
   * Alpaca says is actually still there.
   */

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

    if (
      !position
    ) {
      if (
        progress.qty >
        0
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
              attempt >
              1,
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

    /*
     * Broker is source of truth.
     * Use the exact available string.
     */

    const closeQtyString =
      availableQtyString;

    const closeQty =
      Number(
        closeQtyString
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
            new Date().toISOString(),
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

    /*
     * Do not submit another order while
     * Alpaca still says the previous exit
     * is active.
     */

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

    const afterPositions =
      await getPositions(
        mode
      );

    const remainingPosition =
      findMatchingPosition(
        afterPositions,
        latest.market
      );

    const updatedProgress =
      getExitProgress(
        latest
      );

    /*
     * Position is gone.
     * Finalize using actual executed fills.
     */

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

    /*
     * If rejected/expired without any fill,
     * stop instead of repeatedly firing
     * orders.
     */

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

    /*
     * Otherwise there is a real broker
     * remainder. Loop and close the exact
     * remaining qty.
     */
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

  const ageMinutes =
    (
      Date.now() -
      new Date(
        trade.timestamp ||
        trade.created_at
      ).getTime()
    ) /
    60000;

  const c =
    cfg();

  if (
    favorableMove >=
    Number(
      c.takeProfitPct
    )
  ) {
    const closed =
      await closeTrade(
        mode,
        trade,
        price,

        `${direction} take profit +${favorableMove.toFixed(
          3
        )}%`
      );

    return closed
      ? 'closed'
      : 'open';
  }

  if (
    favorableMove <=
    -Number(
      c.stopLossPct
    )
  ) {
    const closed =
      await closeTrade(
        mode,
        trade,
        price,

        `${direction} stop loss ${favorableMove.toFixed(
          3
        )}%`
      );

    return closed
      ? 'closed'
      : 'open';
  }

  if (
    ageMinutes >=
    Number(
      c.maxHoldMinutes
    )
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
    !state.openTradeIds.length
  ) {
    return 0;
  }

  const ids =
    [
      ...state.openTradeIds,
    ];

  for (
    const id of
    ids
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
      `${maxOpenPositions()} positions — ` +
      `${trade.direction || 'LONG'} ${trade.market}`;

    await manageOne(
      mode,
      trade
    );
  }

  syncOpenTradeIds();

  return state
    .openTradeIds
    .length;
}

async function enter(
  mode
) {
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

  if (
    halt.halt
  ) {
    /*
     * No new positions while halted,
     * but existing positions continue
     * being managed.
     */

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
          new Date().toISOString(),
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
      `${
        state.universe
          .equities.length +
        state.universe
          .crypto.length
      } Alpaca tradable assets — ` +
      `${state.openTradeIds.length}/${maxOpenPositions()} positions open — ` +
      `waiting for LONG or SHORT momentum signal`;

    return false;
  }

  const direction =
    best.direction ||
    'LONG';

  state.lastDecision =
    `${mode.toUpperCase()} ${direction} signal ${best.symbol} ` +
    `${best.momentumPct >= 0 ? '+' : ''}` +
    `${best.momentumPct.toFixed(
      4
    )}%`;

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

  const riskBudget =
    Math.min(
      desiredNotional,
      buyingPower
    );

  if (
    !Number.isFinite(
      riskBudget
    ) ||
    riskBudget < 1
  ) {
    throw new Error(
      `Insufficient ${mode} buying power for configured trade size.`
    );
  }

  let order;

  // ========================================
  // SHORT EQUITY
  // ========================================

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
        riskBudget /
        best.price
      );

    if (
      qty < 1
    ) {
      state.lastDecision =
        `${mode.toUpperCase()} SHORT ${best.symbol} skipped — ` +
        `$${riskBudget.toFixed(2)} budget is below one whole share at ` +
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
  } else {
    // ========================================
    // LONG
    // ========================================

    order =
      await placeOrder({
        mode,

        symbol:
          best.symbol,

        notional:
          Number(
            riskBudget.toFixed(
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
        'standard',

      entryPrice,
    });

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

      entry_signal: {
        direction,

        momentum_pct:
          Number(
            best
              .momentumPct
              .toFixed(4)
          ),

        source:
          'alpaca minute snapshot',
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
    `${entryPrice} — ${state.openTradeIds.length}/${maxOpenPositions()} positions open`;

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
      new Date().toISOString();

    state.lastError =
      null;

    state.exitRetryPending =
      false;

    await manageOpenTrades(
      mode
    );

    /*
     * Do not open a fresh trade while
     * an exit still needs resolution.
     */

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
// START / RECOVERY
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

      if (
        !access.allowed
      ) {
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

      /*
       * If local says a trade is open but
       * Alpaca has no position, inspect
       * Alpaca exit history.
       *
       * This fixes the SHIB-type orphan
       * caused by an order continuing to
       * fill after our old timeout.
       */

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

          if (
            !matchingPosition
          ) {
            const repaired =
              await reconcileMissingPositionFromOrderHistory(
                mode,
                trade
              );

            if (
              !repaired
            ) {
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

        /*
         * Remove any trades repaired above.
         */

        openLocalTrades =
          openLocalTrades
            .filter(
              (
                trade
              ) => {
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

          if (
            !existingSession
          ) {
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
                new Date().toISOString(),
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
                new Date().toISOString(),

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
                `${mode.toUpperCase()} bot positions`,

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
            new Date().toISOString(),

          lastTickAt:
            null,

          lastError:
            null,

          openTradeIds:
            [],

          exitRetryPending:
            false,

          lastDecision:
            `starting ${mode.toUpperCase()} bot — loaded ` +
            `${
              state.universe
                .equities.length +
              state.universe
                .crypto.length
            } Alpaca tradable assets — ` +
            `up to ${maxOpenPositions()} positions`,

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
      if (
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

            if (
              !closed
            ) {
              closeErrors.push(
                `${trade.market}: exit remained partially filled after retry limit`
              );
            }
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
                closeErrors.length >
                0
                  ? `Bot stopped; some positions failed to close: ${closeErrors.join(
                      ' | '
                    )}`
                  : 'Bot stopped by user',

              completed_at:
                new Date().toISOString(),
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
    } catch (
      error
    ) {
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
