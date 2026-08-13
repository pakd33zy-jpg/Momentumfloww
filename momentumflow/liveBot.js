import express from 'express';
import { store } from './store.js';
import { createSession, createTrade, recomputeSessionStats } from './models.js';
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
  hasCredentials,
  placeOrder,
  waitForFill,
} from './alpacaClient.js';

// UNIFIED BOT v14
//
// PAPER = real Alpaca market data + Alpaca paper orders
// LIVE  = same strategy + Alpaca live orders
//
// Equities = LONG + SHORT
// Crypto   = LONG only
//
// v14:
// - up to 3 simultaneous positions
// - manages every open trade each tick
// - opens at most one new position per tick
// - recovers up to 3 positions after restart
// - keeps qty_available crypto exit fix

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
  const value = Math.trunc(
    Number(
      cfg().maxOpenPositions ?? 3
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
  const current =
    store.getConfig(
      'tradingMode',
      {
        mode: 'paper',
      }
    ).mode;

  return current === 'live'
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

    // Backward compatibility with current Dashboard
    openTradeId:
      state.openTradeIds[0] ||
      null,

    // New multi-position fields
    openTradeIds:
      [
        ...state.openTradeIds,
      ],

    openPositionCount:
      state.openTradeIds.length,

    maxOpenPositions:
      maxOpenPositions(),

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
  if (state.timer) {
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

  return state.openTradeIds;
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
            ) > 0
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

  // Prevent duplicate bot positions
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
  // CRYPTO — LONG ONLY
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
  // EQUITIES — LONG + SHORT
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

      if (direction) {
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

async function closeTrade(
  mode,
  trade,
  price,
  reason
) {
  const recordedQtyString =
    positiveQtyString(
      trade.filled_qty ??
      trade.qty
    );

  const recordedQty =
    Number(
      recordedQtyString
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

  const crypto =
    trade.asset_class ===
      'crypto' ||
    String(
      trade.market
    ).includes('/');

  // Alpaca is source of truth
  // for quantity actually available.
  const positions =
    await getPositions(
      mode
    );

  const position =
    findMatchingPosition(
      positions,
      trade.market
    );

  if (!position) {
    throw new Error(
      `No matching Alpaca ${mode} position exists for ${trade.market}. ` +
      `Local trade ${trade.id} is still marked open and needs reconciliation.`
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
      `Alpaca reports no available quantity to close for ${trade.market}.`
    );
  }

  const closeQtyString =
    availableQty <=
    recordedQty
      ? availableQtyString
      : recordedQtyString;

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
      `Invalid close quantity for ${trade.market}.`
    );
  }

  const exitSide =
    direction === 'SHORT'
      ? 'buy'
      : 'sell';

  state.lastDecision =
    `closing ${mode.toUpperCase()} ${direction} ${trade.market} ` +
    `qty ${closeQtyString} — ${reason}`;

  const order =
    await placeOrder({
      mode,

      symbol:
        trade.market,

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
      `Exit order ${order.id} was not filled (status: ${fill.status}).`
    );
  }

  const exitPrice =
    Number(
      fill.filled_avg_price ||
      price
    );

  const entryPrice =
    Number(
      trade.entry_price
    );

  const filledQty =
    Number(
      fill.filled_qty ||
      closeQtyString
    );

  const pnl =
    direction ===
    'SHORT'
      ? (
          entryPrice -
          exitPrice
        ) *
        filledQty
      : (
          exitPrice -
          entryPrice
        ) *
        filledQty;

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
      (
        item
      ) =>
        item.id ===
        trade.id
    );

  if (
    index >= 0
  ) {
    allTrades[index] = {
      ...allTrades[index],

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
        order.id,

      exit_qty:
        filledQty,

      broker_qty_available_at_exit:
        availableQtyString,

      closed_at:
        new Date().toISOString(),
    };

    store.saveAll(
      'trades',
      allTrades
    );
  }

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
        (
          id
        ) =>
          id !==
          trade.id
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
    await closeTrade(
      mode,
      trade,
      price,

      `${direction} take profit +${favorableMove.toFixed(
        3
      )}%`
    );

    return 'closed';
  }

  if (
    favorableMove <=
    -Number(
      c.stopLossPct
    )
  ) {
    await closeTrade(
      mode,
      trade,
      price,

      `${direction} stop loss ${favorableMove.toFixed(
        3
      )}%`
    );

    return 'closed';
  }

  if (
    ageMinutes >=
    Number(
      c.maxHoldMinutes
    )
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
      `managing ${mode.toUpperCase()} ` +
      `${state.openTradeIds.length}/${maxOpenPositions()} positions — ` +
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
      `${mode.toUpperCase()} managing ` +
      `${state.openTradeIds.length}/${maxOpenPositions()} open positions`;

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
     * When there are still open
     * positions, block NEW entries,
     * but keep the bot running so
     * those positions remain managed.
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
    `${best.momentumPct.toFixed(4)}%`;

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

    // First manage everything
    // currently open.
    await manageOpenTrades(
      mode
    );

    // Then fill one empty slot
    // if a valid new signal exists.
    if (
      state.running &&
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
// START / RECOVER
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

      /*
       * Find every unfinished local
       * trade for this mode.
       */
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

      /*
       * RECOVERY
       */
      if (
        openLocalTrades.length
      ) {
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
              .status(409)
              .json({
                error:
                  `Local ${mode} trade ${trade.id} is marked open, but Alpaca ` +
                  `has no matching ${trade.market} position. Reconciliation is required.`,
              });
          }
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

      /*
       * NEW SESSION
       */

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
    } catch (error) {
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
