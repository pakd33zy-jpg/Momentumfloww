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
  evaluateEquityCandidate,
  evaluateCryptoCandidate,
  isCoolingDown,
} from './strategyEngine.js';

// UNIFIED BOT v19 EXPECTANCY
//
// PAPER and LIVE use the same scanner, signals, sizing and execution path.
// v19 changes:
// - supports STRATEGY ENGINE v19 EXPECTANCY
// - larger staged scan
// - rejection diagnostics + near misses
// - stop-distance risk sizing with hard equity/notional caps
// - terminal partial entry fills are tracked using actual filled quantity
// - partial exit progress persists between retries
// - startup checks local quantity against the Alpaca position
//
// No strategy guarantees profit. Validate in Alpaca PAPER first.

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
  nearMisses: [],
  scanDiagnostics: null,

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
  equityBatchSize: 120,
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

  // riskPerTrade is interpreted as requested ACCOUNT risk.
  // The bot caps effective risk even if Settings is higher.
  maxRiskFraction: 0.005,

  // Prevent tiny stops from creating oversized positions.
  maxPositionFractionOfEquity: 0.25,
};

const tradingCfg = () => ({
  riskPerTrade: 0.02,
  ...store.getConfig('tradingConfig', {}),
});

const cfg = () => ({
  ...DEFAULTS,
  ...store.getConfig('liveBotConfig', {}),
});

const strategyCfg = () => ({
  ...STRATEGY_DEFAULTS,
  ...store.getConfig('strategyConfig', {}),
});

function maxOpenPositions() {
  const value = Math.trunc(
    Number(
      cfg().maxOpenPositions ??
      3
    )
  );

  return Number.isFinite(value)
    ? Math.max(
        1,
        Math.min(
          10,
          value
        )
      )
    : 3;
}

function selectedMode() {
  return store.getConfig(
    'tradingMode',
    {
      mode: 'paper',
    }
  ).mode === 'live'
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

function effectiveRiskFraction() {
  const requested =
    Number(
      tradingCfg()
        .riskPerTrade ??
      0.02
    );

  const cap =
    Number(
      cfg()
        .maxRiskFraction ??
      0.005
    );

  if (
    !Number.isFinite(
      requested
    ) ||
    requested <= 0 ||
    requested > 1
  ) {
    throw new Error(
      'Risk per trade must be between 0 and 1 (0.02 = 2%).'
    );
  }

  if (
    !Number.isFinite(
      cap
    ) ||
    cap <= 0 ||
    cap > 1
  ) {
    throw new Error(
      'liveBotConfig.maxRiskFraction must be between 0 and 1.'
    );
  }

  return Math.min(
    requested,
    cap
  );
}

function pub() {
  let effectiveRisk =
    null;

  try {
    effectiveRisk =
      effectiveRiskFraction();
  } catch {
    // Status should still render if a saved risk setting is invalid.
  }

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

    nearMisses:
      state.nearMisses,

    scanDiagnostics:
      state.scanDiagnostics,

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

      requestedRiskPerTrade:
        Number(
          tradingCfg()
            .riskPerTrade ??
          0.02
        ),

      effectiveRiskPerTrade:
        effectiveRisk,

      sizingMode:
        'stop_risk_with_equity_notional_cap',

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

    strategyVersion:
      'v19-expectancy',

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
        cfg()
          .pollSeconds ||
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

  return trades[
    index
  ];
}

function getExitProgress(
  trade
) {
  return {
    qty:
      Number(
        trade
          ?.partial_exit_qty ||
        0
      ),

    value:
      Number(
        trade
          ?.partial_exit_value ||
        0
      ),

    orderIds:
      Array.isArray(
        trade
          ?.partial_exit_order_ids
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
      order
        ?.id ||
      ''
    );

  if (!orderId) {
    throw new Error(
      `Exit order for ${trade.market} has no order id.`
    );
  }

  if (
    progress
      .orderIds
      .includes(
        orderId
      )
  ) {
    return latest;
  }

  const fillQty =
    Number(
      order
        ?.filled_qty ||
      0
    );

  const fillPrice =
    Number(
      order
        ?.filled_avg_price
    );

  const patch = {
    last_exit_order_status:
      order
        ?.status ||
      null,
  };

  if (
    fillQty > 0
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
      fillQty *
        fillPrice;

    patch.partial_exit_order_ids = [
      ...progress
        .orderIds,

      orderId,
    ];
  }

  return saveTradePatch(
    trade.id,
    patch
  );
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
        c
          .universeRefreshMinutes
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

function bump(
  map,
  reason,
  amount = 1
) {
  const key =
    String(
      reason ||
      'unknown'
    );

  map[key] =
    Number(
      map[key] ||
      0
    ) +
    amount;
}

function topReasons(
  map,
  limit = 8
) {
  return Object
    .entries(
      map ||
      {}
    )
    .sort(
      (
        a,
        b
      ) =>
        b[1] -
        a[1]
    )
    .slice(
      0,
      limit
    )
    .map(
      (
        [
          reason,
          count,
        ]
      ) => ({
        reason,
        count,
      })
    );
}

function candidateDiagnosticReason(
  result,
  preferredDirection
) {
  const d =
    result
      ?.diagnostics ||
    {};

  const preferred =
    preferredDirection ===
    'SHORT'
      ? d.short
      : d.long;

  const other =
    preferredDirection ===
    'SHORT'
      ? d.long
      : d.short;

  const threshold =
    Number(
      d.threshold
    );

  for (
    const detail of
    [
      preferred,
      other,
    ]
  ) {
    if (!detail) {
      continue;
    }

    if (
      detail.eligible
    ) {
      const score =
        Number(
          detail.score ||
          0
        );

      if (
        Number.isFinite(
          threshold
        ) &&
        score <
          threshold
      ) {
        return (
          `score ${score}/10 below threshold ${threshold}`
        );
      }

      return (
        'eligible but no signal returned'
      );
    }

    if (
      detail.reason
    ) {
      return detail.reason;
    }
  }

  return (
    'strategy rejected candidate'
  );
}

function pushNearMiss(
  list,
  {
    symbol,
    assetClass,
    direction,
    result,
    momentum,
  }
) {
  const d =
    result
      ?.diagnostics ||
    {};

  const detail =
    direction ===
    'SHORT'
      ? d.short
      : d.long;

  const score =
    Number(
      detail
        ?.score ||
      0
    );

  list.push({
    symbol,
    assetClass,
    direction,
    score,

    reason:
      candidateDiagnosticReason(
        result,
        direction
      ),

    minuteMomentumPct:
      momentum == null
        ? null
        : Number(
            Number(
              momentum
            ).toFixed(
              4
            )
          ),

    trend5Pct:
      detail
        ?.trend5Pct ??
      null,

    trend15Pct:
      detail
        ?.trend15Pct ??
      null,

    recentVolumeRatio:
      detail
        ?.recentVolumeRatio ??
      null,

    spreadPct:
      detail
        ?.spreadPct ??
      null,
  });
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

  const nearMisses =
    [];

  const snapshotsForStatus =
    {};

  const diag = {
    scannedAt:
      now.toISOString(),

    marketOpen:
      null,

    prefilter: {
      crypto:
        {},

      equities:
        {},
    },

    strategy: {
      crypto:
        {},

      equities:
        {},
    },

    counts: {
      cryptoUniverse:
        state.universe
          .crypto.length,

      equityUniverse:
        state.universe
          .equities.length,

      cryptoPrefilterPassed:
        0,

      equityPrefilterPassed:
        0,

      cryptoDetailed:
        0,

      equityDetailed:
        0,

      cryptoQualified:
        0,

      equityQualified:
        0,
    },
  };

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
        bump(
          diag
            .prefilter
            .crypto,

          'no snapshot'
        );

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

      const normalized =
        normPos(
          asset.symbol
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
      };

      if (
        blocked.has(
          normalized
        )
      ) {
        bump(
          diag
            .prefilter
            .crypto,

          'already in position/open trade'
        );

        continue;
      }

      if (
        !canTradeMarket(
          trades,
          asset.symbol
        )
      ) {
        bump(
          diag
            .prefilter
            .crypto,

          'market trade cap reached'
        );

        continue;
      }

      if (
        isCoolingDown(
          trades,
          asset.symbol,
          Number(
            sc
              .cryptoCooldownMinutes
          )
        )
      ) {
        bump(
          diag
            .prefilter
            .crypto,

          'cooldown'
        );

        continue;
      }

      if (
        momentum == null
      ) {
        bump(
          diag
            .prefilter
            .crypto,

          'missing minute momentum'
        );

        continue;
      }

      if (
        momentum <
        Number(
          sc
            .cryptoPrefilterMomentumPct
        )
      ) {
        bump(
          diag
            .prefilter
            .crypto,

          'below crypto prefilter momentum'
        );

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
        bump(
          diag
            .prefilter
            .crypto,

          'spread above crypto max'
        );

        continue;
      }

      diag
        .counts
        .cryptoPrefilterPassed +=
        1;

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

    diag
      .counts
      .cryptoDetailed =
      shortlist.length;

    if (
      shortlist.length
    ) {
      const detailSymbols = [
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
        const result =
          evaluateCryptoCandidate({
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

        const signal =
          result.signal;

        if (!signal) {
          const reason =
            candidateDiagnosticReason(
              result,
              'LONG'
            );

          bump(
            diag
              .strategy
              .crypto,

            reason
          );

          pushNearMiss(
            nearMisses,
            {
              symbol:
                item.asset
                  .symbol,

              assetClass:
                'crypto',

              direction:
                'LONG',

              result,

              momentum:
                item.momentum,
            }
          );

          continue;
        }

        diag
          .counts
          .cryptoQualified +=
          1;

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
      clock
        ?.is_open
    );

  diag.marketOpen =
    state.marketOpen;

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
        bump(
          diag
            .prefilter
            .equities,

          'no snapshot'
        );

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
            c
              .minEquityPrice
          )
      ) {
        bump(
          diag
            .prefilter
            .equities,

          'price below minimum/invalid'
        );

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
        bump(
          diag
            .prefilter
            .equities,

          'daily dollar volume below minimum'
        );

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
      };

      if (
        blocked.has(
          normPos(
            asset.symbol
          )
        )
      ) {
        bump(
          diag
            .prefilter
            .equities,

          'already in position/open trade'
        );

        continue;
      }

      if (
        !canTradeMarket(
          trades,
          asset.symbol
        )
      ) {
        bump(
          diag
            .prefilter
            .equities,

          'market trade cap reached'
        );

        continue;
      }

      if (
        isCoolingDown(
          trades,
          asset.symbol,
          Number(
            sc
              .equityCooldownMinutes
          )
        )
      ) {
        bump(
          diag
            .prefilter
            .equities,

          'cooldown'
        );

        continue;
      }

      if (
        momentum == null
      ) {
        bump(
          diag
            .prefilter
            .equities,

          'missing minute momentum'
        );

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
        bump(
          diag
            .prefilter
            .equities,

          'below equity prefilter momentum'
        );

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
        bump(
          diag
            .prefilter
            .equities,

          'spread above equity max'
        );

        continue;
      }

      diag
        .counts
        .equityPrefilterPassed +=
        1;

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

    diag
      .counts
      .equityDetailed =
      shortlist.length;

    if (
      shortlist.length
    ) {
      const detailSymbols = [
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
        const preferredDirection =
          item.momentum >= 0
            ? 'LONG'
            : 'SHORT';

        const result =
          evaluateEquityCandidate({
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

        const signal =
          result.signal;

        if (!signal) {
          const reason =
            candidateDiagnosticReason(
              result,
              preferredDirection
            );

          bump(
            diag
              .strategy
              .equities,

            reason
          );

          pushNearMiss(
            nearMisses,
            {
              symbol:
                item.asset
                  .symbol,

              assetClass:
                'us_equity',

              direction:
                preferredDirection,

              result,

              momentum:
                item.momentum,
            }
          );

          continue;
        }

        diag
          .counts
          .equityQualified +=
          1;

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
  } else if (
    !state.marketOpen
  ) {
    bump(
      diag
        .prefilter
        .equities,

      'regular equity market closed'
    );
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

  nearMisses.sort(
    (
      a,
      b
    ) =>
      Number(
        b.score ||
        0
      ) -
      Number(
        a.score ||
        0
      )
  );

  state.signalSnapshot =
    Object.fromEntries(
      Object.entries(
        snapshotsForStatus
      ).slice(
        -50
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
            candidate.symbol,

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
            candidate.score,

          rank:
            Number(
              Number(
                candidate.rank ||
                candidate.score
              ).toFixed(
                4
              )
            ),

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

  state.nearMisses =
    nearMisses.slice(
      0,
      10
    );

  state.scanDiagnostics = {
    ...diag,

    topPrefilterRejections: {
      crypto:
        topReasons(
          diag
            .prefilter
            .crypto
        ),

      equities:
        topReasons(
          diag
            .prefilter
            .equities
        ),
    },

    topStrategyRejections: {
      crypto:
        topReasons(
          diag
            .strategy
            .crypto
        ),

      equities:
        topReasons(
          diag
            .strategy
            .equities
        ),
    },
  };

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

  const grossPnl =
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

  const estimatedRoundTripCostPct =
    Math.max(
      0,
      Number(
        trade
          .estimated_round_trip_cost_pct ||
        0
      )
    );

  const estimatedCostDollars =
    entryPrice *
    qty *
    (
      estimatedRoundTripCostPct /
      100
    );

  // Use a conservative estimated net P&L for strategy statistics.
  // Fill prices already capture the execution price/spread; this estimate
  // is mainly for explicit trading costs such as crypto maker/taker fees.
  const pnl =
    grossPnl -
    estimatedCostDollars;

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

  const current =
    trades[index];

  const progress =
    getExitProgress(
      current
    );

  const ids =
    exitOrderIds.length
      ? exitOrderIds
      : progress.orderIds;

  trades[index] = {
    ...current,

    exit_price:
      exitPrice,

    gross_pnl:
      Number(
        grossPnl.toFixed(
          4
        )
      ),

    estimated_cost_dollars:
      Number(
        estimatedCostDollars.toFixed(
          4
        )
      ),

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
      ids[
        ids.length -
        1
      ] ||
      null,

    exit_order_ids:
      [
        ...ids,
      ],

    reconciled_exit:
      Boolean(
        reconciled
      ),

    pending_exit_reason:
      null,

    pending_exit_started_at:
      null,

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
      result === 'loss'
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
  let latest =
    store.getOne(
      'trades',
      trade.id
    ) ||
    trade;

  const lockedReason =
    latest
      .pending_exit_reason ||
    reason;

  if (
    !latest
      .pending_exit_reason
  ) {
    latest =
      saveTradePatch(
        latest.id,
        {
          pending_exit_reason:
            lockedReason,

          pending_exit_started_at:
            new Date()
              .toISOString(),
        }
      );
  }

  reason =
    lockedReason;

  const recordedQty =
    Number(
      positiveQtyString(
        latest
          .filled_qty ??
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

  const assetClass =
    latest.asset_class ||
    (
      String(
        latest.market
      ).includes(
        '/'
      )
        ? 'crypto'
        : 'us_equity'
    );

  const crypto =
    assetClass ===
    'crypto';

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
    latest =
      store.getOne(
        'trades',
        trade.id
      ) ||
      latest;

    const progress =
      getExitProgress(
        latest
      );

    const remainingRecorded =
      Math.max(
        0,

        recordedQty -
        progress.qty
      );

    const tolerance =
      Math.max(
        recordedQty *
          0.002,

        1e-12
      );

    if (
      remainingRecorded <=
        tolerance &&
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

          exitOrderIds:
            progress.orderIds,

          reconciled:
            attempt > 1,
        }
      );
    }

    const positions =
      await getPositions(
        mode
      );

    const position =
      findMatchingPosition(
        positions,
        latest.market
      );

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

            exitOrderIds:
              progress.orderIds,

            reconciled:
              true,
          }
        );
      }

      throw new Error(
        `No matching Alpaca ${mode} position exists for ${latest.market}.`
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
      `closing ${mode.toUpperCase()} ${direction} ${latest.market} ` +
      `qty ${closeQtyString} — ${reason} — attempt ${attempt}`;

    const order =
      await placeOrder({
        mode,

        symbol:
          latest.market,

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

    latest =
      recordExitOrderProgress(
        latest,
        settled
      );

    const updatedProgress =
      getExitProgress(
        latest
      );

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
          `reported no executed quantity.`
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

          exitOrderIds:
            updatedProgress.orderIds,

          reconciled:
            attempt > 1 ||
            settled.status !==
              'filled',
        }
      );
    }

    if (
      Number(
        settled
          .filled_qty ||
        0
      ) <= 0 &&
      [
        'rejected',
        'expired',
      ].includes(
        String(
          settled.status ||
          ''
        )
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
    `partial exit remains for ${latest.market}; will retry before any new entry`;

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

  const trailFloorPct =
    Number(
      trade
        .trail_floor_pct ??
      0
    );

  const breakoutFailureWindowMinutes =
    Number(
      trade
        .breakout_failure_window_minutes ??
      0
    );

  const breakoutFailureAtr =
    Number(
      trade
        .breakout_failure_atr ??
      0
    );

  const maxHoldMinutes =
    Number(
      trade
        .max_hold_minutes ??
      c
        .fallbackMaxHoldMinutes
    );

  const existingProgress =
    getExitProgress(
      trade
    );

  if (
    trade
      .pending_exit_reason ||
    existingProgress.qty > 0
  ) {
    const closed =
      await closeTrade(
        mode,
        trade,
        price,

        trade
          .pending_exit_reason ||
        'continuing partial exit'
      );

    return closed
      ? 'closed'
      : 'open';
  }

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

  const breakoutLevel =
    Number(
      trade
        .entry_signal
        ?.breakout_level
    );

  const entryAtrPct =
    Number(
      trade
        .atr_pct ||
      0
    );

  if (
    breakoutFailureWindowMinutes > 0 &&
    ageMinutes <=
      breakoutFailureWindowMinutes &&
    Number.isFinite(
      breakoutLevel
    ) &&
    breakoutLevel > 0 &&
    entryAtrPct > 0 &&
    breakoutFailureAtr > 0
  ) {
    const atrPrice =
      entryPrice *
      (
        entryAtrPct /
        100
      );

    const failureBuffer =
      atrPrice *
      breakoutFailureAtr;

    const failedBreakout =
      direction ===
      'SHORT'
        ? price >
          breakoutLevel +
            failureBuffer
        : price <
          breakoutLevel -
            failureBuffer;

    if (failedBreakout) {
      const closed =
        await closeTrade(
          mode,
          trade,
          price,

          `${direction} failed breakout invalidation at ${ageMinutes.toFixed(
            1
          )}m`
        );

      return closed
        ? 'closed'
        : 'open';
    }
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

  const trailingExitLevel =
    Math.max(
      trailFloorPct,
      bestMove -
        trailDistancePct
    );

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
      trailingExitLevel
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

function buildPositionBudget({
  equity,
  buyingPower,
  best,
}) {
  const requestedRisk =
    Number(
      tradingCfg()
        .riskPerTrade ??
      0.02
    );

  const effectiveRisk =
    effectiveRiskFraction();

  const stopPct =
    Number(
      best
        ?.signal
        ?.exitPlan
        ?.stopLossPct ??
      cfg()
        .fallbackStopLossPct
    );

  if (
    !Number.isFinite(
      equity
    ) ||
    equity <= 0
  ) {
    throw new Error(
      'Account equity is invalid for position sizing.'
    );
  }

  if (
    !Number.isFinite(
      buyingPower
    ) ||
    buyingPower <= 0
  ) {
    throw new Error(
      'Account buying power is invalid for position sizing.'
    );
  }

  if (
    !Number.isFinite(
      stopPct
    ) ||
    stopPct <= 0
  ) {
    throw new Error(
      `Invalid stop distance for ${best.symbol}.`
    );
  }

  const qualityRiskMultiplier =
    best.score >= 9
      ? 1.0
      : best.score >= 8
        ? 0.75
        : 0.50;

  const earlyEntryRiskMultiplier =
    best
      ?.signal
      ?.earlyEntry
      ? 0.70
      : 1.0;

  const estimatedRoundTripCostPct =
    Math.max(
      0,
      Number(
        best
          ?.signal
          ?.exitPlan
          ?.estimatedRoundTripCostPct ||
        0
      )
    );

  const riskDollars =
    equity *
    effectiveRisk *
    qualityRiskMultiplier *
    earlyEntryRiskMultiplier;

  // Size against the planned stop PLUS estimated explicit round-trip costs.
  // This is especially important for crypto, where taker fees can be material.
  const totalRiskPct =
    stopPct +
    estimatedRoundTripCostPct;

  const riskSizedNotional =
    riskDollars /
    (
      totalRiskPct /
      100
    );

  const maxPositionFraction =
    Number(
      cfg()
        .maxPositionFractionOfEquity ??
      0.50
    );

  if (
    !Number.isFinite(
      maxPositionFraction
    ) ||
    maxPositionFraction <= 0 ||
    maxPositionFraction > 2
  ) {
    throw new Error(
      'liveBotConfig.maxPositionFractionOfEquity must be greater than 0 and no more than 2.'
    );
  }

  const equityCap =
    equity *
    maxPositionFraction;

  const positionBudget =
    Math.min(
      riskSizedNotional,
      equityCap,
      buyingPower
    );

  return {
    requestedRiskFraction:
      requestedRisk,

    effectiveRiskFraction:
      effectiveRisk,

    stopPct,

    estimatedRoundTripCostPct,

    totalRiskPct,

    qualityRiskMultiplier,

    earlyEntryRiskMultiplier,

    riskDollars,

    riskSizedNotional,

    equityCap,

    positionBudget,

    maxPositionFraction,
  };
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
    const topEquity =
      state
        .scanDiagnostics
        ?.topStrategyRejections
        ?.equities
        ?.[0];

    const topCrypto =
      state
        .scanDiagnostics
        ?.topStrategyRejections
        ?.crypto
        ?.[0];

    const top =
      topEquity ||
      topCrypto;

    state.lastDecision =
      `${mode.toUpperCase()} scanning ` +
      `${state.universe.equities.length + state.universe.crypto.length} ` +
      `Alpaca tradable assets — ${state.openTradeIds.length}/` +
      `${maxOpenPositions()} positions open — waiting for v19 setup` +
      (
        top
          ? ` — top reject: ${top.reason} (${top.count})`
          : ''
      );

    return false;
  }

  const direction =
    best.direction ||
    'LONG';

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

  const sizing =
    buildPositionBudget({
      equity,
      buyingPower,
      best,
    });

  if (
    !Number.isFinite(
      sizing.positionBudget
    ) ||
    sizing.positionBudget < 1
  ) {
    state.lastDecision =
      `${mode.toUpperCase()} ${direction} ${best.symbol} skipped — ` +
      `risk-sized budget $${Number(
        sizing.positionBudget ||
        0
      ).toFixed(2)} is below $1`;

    return false;
  }

  state.lastDecision =
    `${mode.toUpperCase()} ${best.strategy} ${direction} ${best.symbol} ` +
    `score ${best.score}/10 — risk budget $${sizing.riskDollars.toFixed(2)} — ` +
    `position budget $${sizing.positionBudget.toFixed(2)}`;

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
        sizing.positionBudget /
        best.price
      );

    if (
      qty < 1
    ) {
      state.lastDecision =
        `${mode.toUpperCase()} SHORT ${best.symbol} skipped — ` +
        `$${sizing.positionBudget.toFixed(2)} risk-sized budget is below one whole share at ` +
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
        sizing.positionBudget /
        best.price
      );

    if (
      qty < 1
    ) {
      state.lastDecision =
        `${mode.toUpperCase()} LONG ${best.symbol} skipped — ` +
        `$${sizing.positionBudget.toFixed(2)} risk-sized budget is below one whole share at ` +
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
            sizing.positionBudget
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

  const fill =
    await settleEntry(
      mode,
      order.id
    );

  const filledQty =
    Number(
      fill
        .filled_qty ||
      0
    );

  if (
    !Number.isFinite(
      filledQty
    ) ||
    filledQty <= 0
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
    entryPrice <= 0
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

      entry_order_status:
        fill.status,

      entry_was_partial:
        fill.status !==
        'filled',

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

      requested_risk_fraction:
        sizing
          .requestedRiskFraction,

      effective_risk_fraction:
        sizing
          .effectiveRiskFraction,

      planned_risk_dollars:
        Number(
          sizing
            .riskDollars
            .toFixed(
              4
            )
        ),

      planned_position_budget:
        Number(
          sizing
            .positionBudget
            .toFixed(
              4
            )
        ),

      sizing_stop_pct:
        sizing.stopPct,

      estimated_round_trip_cost_pct:
        sizing
          .estimatedRoundTripCostPct,

      sizing_total_risk_pct:
        sizing.totalRiskPct,

      quality_risk_multiplier:
        sizing
          .qualityRiskMultiplier,

      early_entry_risk_multiplier:
        sizing
          .earlyEntryRiskMultiplier,

      max_position_fraction_of_equity:
        sizing
          .maxPositionFraction,

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

      trail_floor_pct:
        exitPlan
          .trailFloorPct ??
        0,

      breakout_failure_window_minutes:
        exitPlan
          .breakoutFailureWindowMinutes ??
        0,

      breakout_failure_atr:
        exitPlan
          .breakoutFailureAtr ??
        0,

      max_hold_minutes:
        exitPlan
          .maxHoldMinutes ??
        cfg()
          .fallbackMaxHoldMinutes,

      best_favorable_move_pct:
        0,

      partial_exit_qty:
        0,

      partial_exit_value:
        0,

      partial_exit_order_ids:
        [],

      entry_signal: {
        strategy:
          best.strategy,

        score:
          best.score,

        components:
          best.signal
            ?.components ||
          {},

        trigger:
          best.signal
            ?.trigger ??
          null,

        early_entry:
          best.signal
            ?.earlyEntry ??
          false,

        early_entry_confirmed:
          best.signal
            ?.earlyEntryConfirmed ??
          false,

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

function localRemainingQty(
  trade
) {
  const recorded =
    Number(
      positiveQtyString(
        trade
          .filled_qty ??
        trade.qty
      )
    );

  const progress =
    getExitProgress(
      trade
    );

  return Math.max(
    0,
    recorded -
      progress.qty
  );
}

function positionQty(
  position
) {
  return Math.abs(
    Number(
      position
        ?.qty ||
      0
    )
  );
}

function qtyApproximatelyMatches(
  localQty,
  brokerQty
) {
  if (
    !Number.isFinite(
      localQty
    ) ||
    !Number.isFinite(
      brokerQty
    )
  ) {
    return false;
  }

  if (
    localQty <= 0 ||
    brokerQty <= 0
  ) {
    return false;
  }

  const tolerance =
    Math.max(
      localQty *
        0.02,

      1e-8
    );

  return (
    Math.abs(
      localQty -
      brokerQty
    ) <=
    tolerance
  );
}

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
                  `has no matching ${trade.market} position. Resolve it before restart.`,
              });
          }

          const localQty =
            localRemainingQty(
              trade
            );

          const brokerQty =
            positionQty(
              matchingPosition
            );

          if (
            !qtyApproximatelyMatches(
              localQty,
              brokerQty
            )
          ) {
            return res
              .status(
                409
              )
              .json({
                error:
                  `Quantity mismatch for ${trade.market}: local remaining ${localQty}, ` +
                  `Alpaca position ${brokerQty}. Manual reconciliation is required.`,
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

        const sessionIds = [
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
                (
                  trade
                ) =>
                  trade.id
              ),

            exitRetryPending:
              false,

            lastDecision:
              `recovering ${openLocalTrades.length}/${maxOpenPositions()} ` +
              `${mode.toUpperCase()} positions — v19 expectancy active`,

            signalSnapshot:
              {},

            topCandidates:
              [],

            nearMisses:
              [],

            scanDiagnostics:
              null,

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
            `starting ${mode.toUpperCase()} v19 expectancy bot — loaded ` +
            `${state.universe.equities.length + state.universe.crypto.length} ` +
            `Alpaca tradable assets — up to ${maxOpenPositions()} positions`,

          signalSnapshot:
            {},

          topCandidates:
            [],

          nearMisses:
            [],

          scanDiagnostics:
            null,

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

            const closed =
              await closeTrade(
                mode,
                trade,
                price,
                'bot stopped by user'
              );

            if (!closed) {
              closeErrors.push(
                `${trade.market}: exit remains partially filled after retry limit`
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
