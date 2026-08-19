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

import {
  EQUITY_V20_DEFAULTS,
  equityPrefilterQuality,
  evaluateEquityCandidateV20,
} from './equityStrategyV20.js';

// UNIFIED BOT v20 ADAPTIVE EQUITIES
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
  moverLeaderboard: [],
  rejectionOutcomes: [],
  scanDiagnostics: null,

  universe: {
    equities: [],
    crypto: [],
    refreshedAt: null,
  },

  equityCursor: 0,
  marketOpen: null,
  equitySession: 'closed',
};

const DEFAULTS = {
  pollSeconds: 5,
  maxOpenPositions: 3,
  equityBatchSize: 300,
  universeRefreshMinutes: 5,
  moverLeaderboardSize: 30,
  rejectionOutcomeMax: 500,
  rejectionOutcomeSeedIntervalMs: 60000,
  rejectionOutcomeUpdateIntervalMs: 60000,
  rejectionOutcomeSeedLimit: 5,

  minEquityPrice: 1,
  minDailyDollarVolume: 5000000,
  adaptiveLiquidityEnabled: true,
  adaptiveLiquidityMediumDollarVolume: 2000000,
  adaptiveLiquidityStrongDollarVolume: 1000000,
  adaptiveLiquidityMediumMomentumPct: 0.04,
  adaptiveLiquidityStrongMomentumPct: 0.08,
  adaptiveLiquidityMediumMaxSpreadPct: 0.10,
  adaptiveLiquidityStrongMaxSpreadPct: 0.08,
  stockFeed: 'iex',

  // PAPER-only extended-hours equity test.
  // LIVE behavior remains regular-hours only unless explicitly redesigned later.
  paperExtendedEquityEnabled: true,
  extendedEquityLimitCollarPct: 0.15,

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

  // Leave room for price movement, broker haircuts and in-flight commitments.
  entryBuyingPowerFraction: 0.90,

  // A rejected NEW entry should not kill the whole bot.
  entryBuyingPowerRejectCooldownMs: 60000,
};

const tradingCfg = () => ({
  riskPerTrade: 0.02,
  ...store.getConfig('tradingConfig', {}),
});

const cfg = () => ({
  ...DEFAULTS,
  ...store.getConfig('liveBotConfig', {}),
});

let lastRejectionOutcomeSeedAt = 0;
let lastRejectionOutcomeUpdateAt = 0;

let entryBuyingPowerCooldownUntil = 0;
let entryBuyingPowerCooldownSymbol = null;

function isBuyingPowerEntryError(error) {
  return /buying power/i.test(
    String(
      error?.message ||
      ''
    )
  );
}

function buyingPowerFraction() {
  const value = Number(
    cfg().entryBuyingPowerFraction ??
    0.90
  );

  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    value >= 1
  ) {
    throw new Error(
      'liveBotConfig.entryBuyingPowerFraction must be greater than 0 and less than 1.'
    );
  }

  return value;
}

const strategyCfg = () => ({
  ...STRATEGY_DEFAULTS,
  ...EQUITY_V20_DEFAULTS,
  ...store.getConfig('strategyConfig', {}),

  equityFocusMode:
    tradingCfg().equityFocusMode === true,

  equityV20Enabled:
    tradingCfg().equityV20Enabled !== false,

  equityFastScalpEnabled:
    tradingCfg().equityFastScalpEnabled === true,
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

function equitySessionNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat(
    'en-US',
    {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }
  ).formatToParts(date);

  const get = (type) =>
    parts.find(
      (part) =>
        part.type === type
    )?.value;

  const weekday = get('weekday');
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const minutes = hour * 60 + minute;

  const monFri =
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
      .includes(weekday);

  if (
    monFri &&
    minutes >= 570 &&
    minutes < 960
  ) {
    return 'regular';
  }

  if (
    monFri &&
    minutes >= 240 &&
    minutes < 570
  ) {
    return 'pre';
  }

  if (
    monFri &&
    minutes >= 960 &&
    minutes < 1200
  ) {
    return 'after';
  }

  // BOATS overnight: Sun 8pm onward, Mon-Thu 8pm onward,
  // and Mon-Fri midnight through 4am.
  if (
    (
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu']
        .includes(weekday) &&
      minutes >= 1200
    ) ||
    (
      monFri &&
      minutes < 240
    )
  ) {
    return 'overnight';
  }

  return 'closed';
}

function extendedEquityAllowed(mode) {
  return (
    mode === 'paper' &&
    cfg().paperExtendedEquityEnabled !== false &&
    ['pre', 'after', 'overnight']
      .includes(
        equitySessionNow()
      )
  );
}

function extendedLimitPrice(price, side) {
  const p = Number(price);
  const collarPct = Number(
    cfg().extendedEquityLimitCollarPct ?? 0.15
  );

  if (
    !Number.isFinite(p) ||
    p <= 0
  ) {
    throw new Error(
      'Cannot create extended-hours limit without a valid reference price.'
    );
  }

  const collar =
    Number.isFinite(collarPct) &&
    collarPct > 0
      ? collarPct / 100
      : 0.0015;

  const adjusted =
    side === 'buy'
      ? p * (1 + collar)
      : p * (1 - collar);

  // Alpaca accepts sub-penny pricing below $1; otherwise use pennies.
  const decimals =
    adjusted < 1
      ? 4
      : 2;

  return Number(
    adjusted.toFixed(decimals)
  );
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



const REJECTION_OUTCOME_HORIZONS_MIN = [5, 15, 30, 60];

function rejectionOutcomeId(row, observedMs) {
  return [
    'rejectOutcome',
    row.assetClass || 'unknown',
    String(row.symbol || '').replace('/', ''),
    String(row.direction || 'LONG'),
    Math.floor(observedMs / 60000),
  ].join('-');
}

async function seedRejectedOpportunityOutcomes(mode, nearMisses) {
  const now = Date.now();
  const interval = Math.max(
    15000,
    Number(cfg().rejectionOutcomeSeedIntervalMs || 60000)
  );

  if (now - lastRejectionOutcomeSeedAt < interval) return;
  lastRejectionOutcomeSeedAt = now;

  const current = store.getAll('rejectionOutcomes');
  const recentCutoff = now - 15 * 60000;

  const recentKeys = new Set(
    current
      .filter((row) =>
        new Date(row.observedAt || 0).getTime() >= recentCutoff
      )
      .map((row) =>
        `${row.assetClass}|${row.symbol}|${row.direction}|${row.reason}`
      )
  );

  const wanted = (nearMisses || [])
    .filter((row) => {
      const key =
        `${row.assetClass}|${row.symbol}|${row.direction}|${row.reason}`;
      return row.symbol && !recentKeys.has(key);
    })
    .slice(
      0,
      Math.max(1, Number(cfg().rejectionOutcomeSeedLimit || 5))
    );

  if (!wanted.length) return;

  const settled = await Promise.allSettled(
    wanted.map(async (row) => {
      const baselinePrice = await getLatestTradablePrice(
        mode,
        row.symbol,
        row.assetClass
      );

      const price = Number(baselinePrice);
      if (!Number.isFinite(price) || price <= 0) {
        throw new Error(`No baseline price for ${row.symbol}`);
      }

      return {
        id: rejectionOutcomeId(row, now),
        observedAt: new Date(now).toISOString(),
        mode,
        sessionId: state.sessionId,
        assetClass: row.assetClass,
        symbol: row.symbol,
        direction: row.direction || 'LONG',
        reason: row.reason || 'unknown',
        strategyScore: Number(row.score || 0),
        minuteMomentumPct:
          row.minuteMomentumPct == null
            ? null
            : Number(row.minuteMomentumPct),
        spreadPct:
          row.spreadPct == null
            ? null
            : Number(row.spreadPct),
        recentVolumeRatio:
          row.recentVolumeRatio == null
            ? null
            : Number(row.recentVolumeRatio),
        baselinePrice: price,
        outcomes: {},
      };
    })
  );

  const added = settled
    .filter((x) => x.status === 'fulfilled')
    .map((x) => x.value);

  if (!added.length) return;

  const max = Math.max(
    100,
    Number(cfg().rejectionOutcomeMax || 500)
  );

  const saved = [...current, ...added].slice(-max);
  store.saveAll('rejectionOutcomes', saved);
  state.rejectionOutcomes = saved;
}

async function updateRejectedOpportunityOutcomes(mode) {
  const now = Date.now();
  const interval = Math.max(
    30000,
    Number(cfg().rejectionOutcomeUpdateIntervalMs || 60000)
  );

  if (now - lastRejectionOutcomeUpdateAt < interval) return;
  lastRejectionOutcomeUpdateAt = now;

  const rows = store.getAll('rejectionOutcomes');
  if (!rows.length) return;

  const due = rows
    .map((row, index) => {
      const observed = new Date(row.observedAt || 0).getTime();
      const ageMin =
        Number.isFinite(observed)
          ? (now - observed) / 60000
          : -1;

      const horizon = REJECTION_OUTCOME_HORIZONS_MIN.find(
        (h) =>
          ageMin >= h &&
          row.outcomes?.[`m${h}`] == null
      );

      return { row, index, ageMin, horizon };
    })
    .filter((x) => x.horizon != null)
    .slice(0, 12);

  if (!due.length) return;

  const settled = await Promise.allSettled(
    due.map(async (item) => {
      const price = Number(
        await getLatestTradablePrice(
          mode,
          item.row.symbol,
          item.row.assetClass
        )
      );

      if (!Number.isFinite(price) || price <= 0) {
        throw new Error(`No outcome price for ${item.row.symbol}`);
      }

      const rawReturnPct =
        ((price - Number(item.row.baselinePrice)) /
          Number(item.row.baselinePrice)) * 100;

      const directionReturnPct =
        item.row.direction === 'SHORT'
          ? -rawReturnPct
          : rawReturnPct;

      return {
        index: item.index,
        horizon: item.horizon,
        value: {
          price,
          rawReturnPct: Number(rawReturnPct.toFixed(4)),
          directionReturnPct:
            Number(directionReturnPct.toFixed(4)),
          sampledAgeMinutes:
            Number(item.ageMin.toFixed(2)),
          sampledAt: new Date(now).toISOString(),
        },
      };
    })
  );

  let changed = false;

  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    const { index, horizon, value } = result.value;

    rows[index] = {
      ...rows[index],
      outcomes: {
        ...(rows[index].outcomes || {}),
        [`m${horizon}`]: value,
      },
    };
    changed = true;
  }

  if (changed) {
    const max = Math.max(
      100,
      Number(cfg().rejectionOutcomeMax || 500)
    );
    const saved = rows.slice(-max);
    store.saveAll('rejectionOutcomes', saved);
    state.rejectionOutcomes = saved;
  }
}

function rejectionOutcomeSummary() {
  const rows = store.getAll('rejectionOutcomes');

  const horizons = Object.fromEntries(
    REJECTION_OUTCOME_HORIZONS_MIN.map((h) => {
      const values = rows
        .map((row) =>
          row.outcomes?.[`m${h}`]?.directionReturnPct
        )
        .filter(Number.isFinite);

      const avg = values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : null;

      return [
        `m${h}`,
        {
          samples: values.length,
          avgDirectionReturnPct:
            avg == null ? null : Number(avg.toFixed(4)),
          positivePct:
            values.length
              ? Number(
                  (
                    values.filter((v) => v > 0).length /
                    values.length * 100
                  ).toFixed(2)
                )
              : null,
        },
      ];
    })
  );

  return {
    totalTracked: rows.length,
    horizons,
    recent: rows.slice(-25).reverse(),
  };
}

function opportunityScore(snapshot) {
  const momentum = Math.abs(Number(minuteMomentumPct(snapshot) || 0));
  const spread = Number(spreadPct(snapshot));
  const volume = Number(dailyDollarVolume(snapshot) || 0);
  const momentumPoints = Math.min(60, momentum * 500);
  const volumePoints = Math.min(30, Math.log10(Math.max(1, volume)) * 4);
  const spreadPenalty = Number.isFinite(spread) ? Math.min(50, spread * 100) : 50;
  return Number(Math.max(0, momentumPoints + volumePoints - spreadPenalty).toFixed(3));
}

function rememberMover(market, symbol, snapshot, status, reason = null) {
  if (!symbol || !snapshot) return;
  const row = {
    market, symbol, status, reason,
    score: opportunityScore(snapshot),
    momentumPct: Number(minuteMomentumPct(snapshot) || 0),
    spreadPct: spreadPct(snapshot),
    dollarVolume: Number(dailyDollarVolume(snapshot) || 0),
    observedAt: new Date().toISOString(),
  };
  const without = state.moverLeaderboard.filter(
    (x) => !(x.market === market && x.symbol === symbol)
  );
  state.moverLeaderboard = [...without, row]
    .sort((a,b) => b.score - a.score)
    .slice(0, Math.max(10, Number(cfg().moverLeaderboardSize || 30)));
  if (status === 'rejected') {
    state.rejectionOutcomes.push(row);
    const max = Math.max(100, Number(cfg().rejectionOutcomeMax || 500));
    if (state.rejectionOutcomes.length > max)
      state.rejectionOutcomes = state.rejectionOutcomes.slice(-max);
  }
}

function strategyPerformanceSummary() {
  const mode =
    state.mode ||
    selectedMode();

  const closed =
    store
      .getAll('trades')
      .filter(
        (trade) =>
          trade.result !== null &&
          (
            trade.execution_mode ||
            'paper'
          ) === mode
      )
      .slice(-300);

  const groups =
    new Map();

  for (const trade of closed) {
    const strategy =
      String(
        trade.strategy_name ||
        trade.entry_signal
          ?.strategy ||
        'LEGACY'
      );

    if (!groups.has(strategy)) {
      groups.set(
        strategy,
        {
          strategy,
          trades: 0,
          wins: 0,
          losses: 0,
          pnl: 0,
          grossWin: 0,
          grossLoss: 0,
          lastClosedAt: null,
        }
      );
    }

    const row =
      groups.get(strategy);

    const pnl =
      Number(
        trade.pnl ||
        0
      );

    row.trades += 1;
    row.pnl += pnl;

    if (pnl > 0) {
      row.wins += 1;
      row.grossWin += pnl;
    } else if (pnl < 0) {
      row.losses += 1;
      row.grossLoss +=
        Math.abs(pnl);
    }

    const closedAt =
      trade.closed_at ||
      trade.timestamp ||
      null;

    if (
      closedAt &&
      (
        !row.lastClosedAt ||
        new Date(closedAt) >
          new Date(
            row.lastClosedAt
          )
      )
    ) {
      row.lastClosedAt =
        closedAt;
    }
  }

  return [
    ...groups.values(),
  ]
    .map((row) => {
      const averageWin =
        row.wins > 0
          ? row.grossWin /
            row.wins
          : 0;

      const averageLoss =
        row.losses > 0
          ? row.grossLoss /
            row.losses
          : 0;

      const expectancy =
        row.trades > 0
          ? row.pnl /
            row.trades
          : 0;

      return {
        strategy:
          row.strategy,
        trades:
          row.trades,
        wins:
          row.wins,
        losses:
          row.losses,
        winRate:
          row.trades > 0
            ? Number(
                (
                  row.wins /
                  row.trades *
                  100
                ).toFixed(2)
              )
            : 0,
        pnl:
          Number(
            row.pnl.toFixed(4)
          ),
        averageWin:
          Number(
            averageWin.toFixed(4)
          ),
        averageLoss:
          Number(
            averageLoss.toFixed(4)
          ),
        expectancy:
          Number(
            expectancy.toFixed(4)
          ),
        profitFactor:
          row.grossLoss > 0
            ? Number(
                (
                  row.grossWin /
                  row.grossLoss
                ).toFixed(3)
              )
            : row.grossWin > 0
              ? 'Infinity'
              : 0,
        sampleEnough:
          row.trades >= 30,
        lastClosedAt:
          row.lastClosedAt,
      };
    })
    .sort(
      (a, b) =>
        Number(b.pnl) -
        Number(a.pnl)
    );
}

function executionQualitySummary() {
  const mode =
    state.mode ||
    selectedMode();

  const trades =
    store
      .getAll('trades')
      .filter(
        (trade) =>
          (
            trade.execution_mode ||
            'paper'
          ) === mode
      )
      .slice(-300);

  const entries =
    trades.filter(
      (trade) =>
        Number.isFinite(
          Number(
            trade.entry_slippage_bps
          )
        )
    );

  const exits =
    trades.filter(
      (trade) =>
        Number.isFinite(
          Number(
            trade.exit_slippage_bps
          )
        )
    );

  const average = (values) =>
    values.length
      ? values.reduce(
          (sum, value) =>
            sum + value,
          0
        ) / values.length
      : null;

  const percentile90 = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(
      sorted.length - 1,
      Math.ceil(sorted.length * 0.90) - 1
    );
    return sorted[index];
  };

  const entrySlippage =
    entries.map(
      (trade) =>
        Number(
          trade.entry_slippage_bps
        )
    );

  const exitSlippage =
    exits.map(
      (trade) =>
        Number(
          trade.exit_slippage_bps
        )
    );

  const fillPcts =
    trades
      .map(
        (trade) =>
          Number(
            trade.planned_budget_filled_pct
          )
      )
      .filter(Number.isFinite);

  const exposurePcts =
    trades
      .map(
        (trade) =>
          Number(
            trade.entry_exposure_pct
          )
      )
      .filter(Number.isFinite);

  return {
    measuredEntries:
      entries.length,

    measuredExits:
      exits.length,

    avgEntrySlippageBps:
      average(
        entrySlippage
      ),

    p90EntrySlippageBps:
      percentile90(
        entrySlippage
      ),

    avgExitSlippageBps:
      average(
        exitSlippage
      ),

    p90ExitSlippageBps:
      percentile90(
        exitSlippage
      ),

    partialEntries:
      trades.filter(
        (trade) =>
          trade.entry_was_partial ===
          true
      ).length,

    reconciledExits:
      trades.filter(
        (trade) =>
          trade.reconciled_exit ===
          true
      ).length,

    avgPlannedBudgetFilledPct:
      average(
        fillPcts
      ),

    avgEntryExposurePct:
      average(
        exposurePcts
      ),

    maxEntryExposurePct:
      exposurePcts.length
        ? Math.max(
            ...exposurePcts
          )
        : null,

    sampleEnough:
      Math.min(
        entries.length,
        exits.length
      ) >= 30,

    worstEntrySlippage:
      entries
        .map(
          (trade) => ({
            tradeId:
              trade.id,

            market:
              trade.market,

            direction:
              trade.direction,

            slippageBps:
              Number(
                trade.entry_slippage_bps
              ),
          })
        )
        .sort(
          (a, b) =>
            b.slippageBps -
            a.slippageBps
        )
        .slice(
          0,
          5
        ),
  };
}

function paperForwardSessionSummary() {
  if (!state.sessionId) {
    return null;
  }

  const session =
    store.getOne(
      'sessions',
      state.sessionId
    );

  if (!session) {
    return null;
  }

  const trades =
    store
      .getAll('trades')
      .filter(
        (trade) =>
          trade.session_id ===
          state.sessionId
      );

  const closed =
    trades.filter(
      (trade) =>
        trade.result !==
        null
    );

  const open =
    trades.filter(
      (trade) =>
        trade.result ===
        null
    );

  const numeric = (value) => {
    const n = Number(value);
    return Number.isFinite(n)
      ? n
      : null;
  };

  const average = (values) =>
    values.length
      ? values.reduce(
          (sum, value) =>
            sum + value,
          0
        ) / values.length
      : null;

  const startingCapital =
    numeric(
      session.starting_capital ??
      session.startingCapital
    );

  const realizedPnl =
    closed.reduce(
      (sum, trade) =>
        sum +
        Number(
          trade.pnl ||
          0
        ),
      0
    );

  const wins =
    closed.filter(
      (trade) =>
        Number(
          trade.pnl ||
          0
        ) >
        0
    ).length;

  const entryExposure =
    trades
      .map(
        (trade) =>
          numeric(
            trade.entry_exposure_pct
          )
      )
      .filter(
        Number.isFinite
      );

  const entrySlippage =
    trades
      .map(
        (trade) =>
          numeric(
            trade.entry_slippage_bps
          )
      )
      .filter(
        Number.isFinite
      );

  const exitSlippage =
    closed
      .map(
        (trade) =>
          numeric(
            trade.exit_slippage_bps
          )
      )
      .filter(
        Number.isFinite
      );

  const currentExposureNotional =
    open.reduce(
      (sum, trade) =>
        sum +
        Number(
          trade.actual_entry_notional ||
          0
        ),
      0
    );

  const currentExposurePctEstimate =
    startingCapital &&
    startingCapital >
      0
      ? (
          currentExposureNotional /
          startingCapital
        ) *
        100
      : null;

  // Estimate peak concurrent exposure by sweeping recorded trade lifetimes.
  const exposureEvents = [];

  for (const trade of trades) {
    const exposure =
      numeric(
        trade.entry_exposure_pct
      );

    const openedAt =
      new Date(
        trade.timestamp ||
        trade.created_at ||
        0
      ).getTime();

    if (
      !Number.isFinite(exposure) ||
      !Number.isFinite(openedAt) ||
      openedAt <= 0
    ) {
      continue;
    }

    exposureEvents.push({
      time: openedAt,
      delta: exposure,
    });

    if (trade.closed_at) {
      const closedAt =
        new Date(
          trade.closed_at
        ).getTime();

      if (
        Number.isFinite(closedAt) &&
        closedAt >= openedAt
      ) {
        exposureEvents.push({
          time: closedAt,
          delta: -exposure,
        });
      }
    }
  }

  exposureEvents.sort(
    (a, b) =>
      a.time - b.time ||
      b.delta - a.delta
  );

  let runningExposure = 0;
  let maxConcurrentExposure = 0;

  for (const event of exposureEvents) {
    runningExposure =
      Math.max(
        0,
        runningExposure +
          event.delta
      );

    maxConcurrentExposure =
      Math.max(
        maxConcurrentExposure,
        runningExposure
      );
  }

  return {
    sessionId:
      state.sessionId,

    mode:
      state.mode ||
      session.mode ||
      selectedMode(),

    startingCapital,

    tradesEntered:
      trades.length,

    closedTrades:
      closed.length,

    openTrades:
      open.length,

    realizedPnl:
      Number(
        realizedPnl
          .toFixed(
            4
          )
      ),

    realizedReturnPct:
      startingCapital &&
      startingCapital >
        0
        ? Number(
            (
              realizedPnl /
              startingCapital *
              100
            ).toFixed(
              4
            )
          )
        : null,

    winRatePct:
      closed.length
        ? Number(
            (
              wins /
              closed.length *
              100
            ).toFixed(
              2
            )
          )
        : null,

    currentExposurePctEstimate:
      Number.isFinite(
        currentExposurePctEstimate
      )
        ? Number(
            currentExposurePctEstimate
              .toFixed(
                4
              )
          )
        : null,

    maxConcurrentExposurePctEstimate:
      exposureEvents.length
        ? Number(
            maxConcurrentExposure
              .toFixed(
                4
              )
          )
        : null,

    maxSingleTradeExposurePct:
      entryExposure.length
        ? Number(
            Math.max(
              ...entryExposure
            ).toFixed(
              4
            )
          )
        : null,

    avgEntrySlippageBps:
      entrySlippage.length
        ? Number(
            average(
              entrySlippage
            ).toFixed(
              4
            )
          )
        : null,

    avgExitSlippageBps:
      exitSlippage.length
        ? Number(
            average(
              exitSlippage
            ).toFixed(
              4
            )
          )
        : null,

    partialEntries:
      trades.filter(
        (trade) =>
          trade.entry_was_partial ===
          true
      ).length,

    reconciledExits:
      closed.filter(
        (trade) =>
          trade.reconciled_exit ===
          true
      ).length,
  };
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

    rejectionOutcomeLearning:
      rejectionOutcomeSummary(),

    scanDiagnostics:
      state.scanDiagnostics,

    strategyPerformance:
      strategyPerformanceSummary(),

    executionQuality:
      executionQualitySummary(),

    paperForwardSession:
      paperForwardSessionSummary(),

    marketOpen:
      state.marketOpen,

    equitySession:
      state.equitySession,

    paperExtendedEquityEnabled:
      cfg().paperExtendedEquityEnabled !== false,

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
      'v20-adaptive-equities',

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


function adaptiveLiquidityThreshold(snapshot, config) {
  const base = Math.max(
    0,
    Number(config.minDailyDollarVolume || 5000000)
  );

  if (config.adaptiveLiquidityEnabled === false) {
    return base;
  }

  const momentum = Math.abs(
    Number(minuteMomentumPct(snapshot) || 0)
  );
  const spread = spreadPct(snapshot);

  if (
    momentum >= Number(config.adaptiveLiquidityStrongMomentumPct ?? 0.08) &&
    spread != null &&
    spread <= Number(config.adaptiveLiquidityStrongMaxSpreadPct ?? 0.08)
  ) {
    return Math.min(
      base,
      Number(config.adaptiveLiquidityStrongDollarVolume || 1000000)
    );
  }

  if (
    momentum >= Number(config.adaptiveLiquidityMediumMomentumPct ?? 0.04) &&
    spread != null &&
    spread <= Number(config.adaptiveLiquidityMediumMaxSpreadPct ?? 0.10)
  ) {
    return Math.min(
      base,
      Number(config.adaptiveLiquidityMediumDollarVolume || 2000000)
    );
  }

  return base;
}

function adaptiveCryptoPrefilterMomentum(snapshot, strategyConfig) {
  const base = Number(
    strategyConfig.cryptoPrefilterMomentumPct ?? 0.035
  );
  const spread = spreadPct(snapshot);

  if (spread == null) return base;
  if (spread <= 0.10) return Math.min(base, 0.020);
  if (spread <= 0.18) return Math.min(base, 0.030);
  return base;
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
  preMomentum = 0,
  prefilterQuality = 0
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

  const spread =
    Number(
      signal
        ?.signal
        ?.spreadPct
    );

  const strategy =
    String(
      signal
        ?.strategy ||
      ''
    );

  const setupBonus =
    strategy.includes(
      'VWAP_PULLBACK'
    )
      ? 0.65
      : strategy.includes(
          'ORB'
        )
        ? 0.55
        : strategy.includes(
            'TREND_CONTINUATION'
          )
          ? 0.45
          : strategy.includes(
              'FAST_SCALP'
            )
            ? 0.15
            : 0;

  const spreadBonus =
    Number.isFinite(
      spread
    )
      ? Math.max(
          0,
          1 -
            spread /
              0.08
        )
      : 0;

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
      1.25,
      Math.max(
        0,
        volume - 0.75
      )
    ) +

    Math.min(
      0.75,
      Math.abs(
        Number(
          preMomentum ||
          0
        )
      ) * 3
    ) +

    Math.min(
      1.25,
      Math.max(
        0,
        Number(
          prefilterQuality ||
          0
        ) *
          0.15
      )
    ) +

    spreadBonus +
    setupBonus
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
const REJECTION_LOG_INTERVAL_MS =
  60 * 1000;

const REJECTION_LOG_LIMIT =
  500;

function readRejectionLog(
  limit = 100
) {
  const safeLimit =
    Math.max(
      1,
      Math.min(
        REJECTION_LOG_LIMIT,
        Number(
          limit ||
          100
        )
      )
    );

  return store
    .getAll(
      'rejectionLog'
    )
    .slice(
      -safeLimit
    )
    .reverse();
}

function recordRejectionSnapshot(
  mode,
  diagnostics,
  nearMisses,
  topCandidates
) {
  if (!diagnostics) {
    return;
  }

  const now =
    Date.now();

  const entries =
    store.getAll(
      'rejectionLog'
    );

  const last =
    entries.at(
      -1
    );

  const lastTime =
    last?.timestamp
      ? new Date(
          last.timestamp
        ).getTime()
      : 0;

  // Only save one snapshot per minute.
  // The bot still scans every few seconds.
  if (
    last &&
    last.mode === mode &&
    Number.isFinite(
      lastTime
    ) &&
    now -
      lastTime <
      REJECTION_LOG_INTERVAL_MS
  ) {
    return;
  }

  const counts =
    diagnostics.counts ||
    {};

  const entry = {
    id:
      `reject-${now}`,

    timestamp:
      new Date(
        now
      ).toISOString(),

    session_id:
      state.sessionId,

    mode,

    strategy_version:
      'v20-adaptive-equities',

    market_open:
      Boolean(
        diagnostics.marketOpen
      ),

    open_positions:
      state.openTradeIds.length,

    qualified:
      Number(
        counts.equityQualified ||
        0
      ) +
      Number(
        counts.cryptoQualified ||
        0
      ),

    counts,

    top_prefilter_rejections:
      diagnostics
        .topPrefilterRejections ||
      {
        equities: [],
        crypto: [],
      },

    top_strategy_rejections:
      diagnostics
        .topStrategyRejections ||
      {
        equities: [],
        crypto: [],
      },

    liquidity_gate:
      diagnostics
        .liquidityGate ||
      null,

    near_misses:
      Array.isArray(
        nearMisses
      )
        ? nearMisses.slice(
            0,
            10
          )
        : [],

    top_candidates:
      Array.isArray(
        topCandidates
      )
        ? topCandidates.slice(
            0,
            5
          )
        : [],
  };

  entries.push(
    entry
  );

  store.saveAll(
    'rejectionLog',
    entries.slice(
      -REJECTION_LOG_LIMIT
    )
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

    liquidityGate: {
      basis:
        'previous completed daily bar; current daily bar only as fallback',

      threshold:
        Number(
          c
            .minDailyDollarVolume
        ),

      rejected:
        0,

      samples:
        [],
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

  const equityFocusMode =
  tradingCfg()
    .equityFocusMode === true;

if (equityFocusMode) {
  bump(
    diag
      .prefilter
      .crypto,

    'crypto disabled by equity focus mode'
  );
}

if (
  !equityFocusMode &&
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

      const cryptoMomentumThreshold =
        adaptiveCryptoPrefilterMomentum(
          snapshot,
          sc
        );

      if (
        momentum <
        cryptoMomentumThreshold
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

  state.equitySession =
    state.marketOpen
      ? 'regular'
      : equitySessionNow();

  const allowExtendedEquities =
    extendedEquityAllowed(
      mode
    );

  diag.marketOpen =
    state.marketOpen;

  diag.equitySession =
    state.equitySession;

  diag.extendedEquityPaper =
    allowExtendedEquities;

  // Free-plan overnight market data uses Alpaca's derived overnight feed.
  if (
    allowExtendedEquities &&
    state.equitySession ===
      'overnight'
  ) {
    // This Alpaca account does not currently have BOATS entitlement.
    // Never let an optional overnight equity feed stop the 24/7 bot.
    // Keep the configured/default stock feed and allow crypto to continue.
    diag.overnightEquityData =
      'BOATS unavailable; overnight equity scan skipped';
  }

  const canScanEquities =
    state.marketOpen ||
    (
      allowExtendedEquities &&
      state.equitySession !== 'overnight'
    );

  if (
    canScanEquities &&
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

      const liquidityThreshold =
        adaptiveLiquidityThreshold(
          snapshot,
          c
        );

      if (
        dollarVolume <
        liquidityThreshold
      ) {
        bump(
          diag
            .prefilter
            .equities,

          'completed-day dollar volume below minimum'
        );

        diag
          .liquidityGate
          .rejected +=
          1;

        if (
          diag
            .liquidityGate
            .samples
            .length <
          10
        ) {
          const currentSessionDollarVolume =
            Number(
              snapshot
                ?.dailyBar
                ?.c ||
              0
            ) *
            Number(
              snapshot
                ?.dailyBar
                ?.v ||
              0
            );

          diag
            .liquidityGate
            .samples
            .push({
              symbol:
                asset.symbol,

              completedDayDollarVolume:
                Math.round(
                  dollarVolume
                ),

              requiredDollarVolume:
                Math.round(
                  liquidityThreshold
                ),

              currentSessionDollarVolume:
                Math.round(
                  currentSessionDollarVolume
                ),
            });
        }

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

      const preQuality =
      equityPrefilterQuality({
        snapshot,
        momentum,
        dollarVolume,
        spread,
        config: sc,
      });

    pre.push({
      asset,
      snapshot,
      momentum,
      prefilterQuality:
        preQuality.quality,
      dayMovePct:
        preQuality.dayMovePct,
    });
    }

    pre.sort(
      (
        a,
        b
      ) =>
        Number(
          b.prefilterQuality ||
          0
        ) -
        Number(
          a.prefilterQuality ||
          0
        ) ||
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
        sc.equityV20Enabled !== false
          ? evaluateEquityCandidateV20({
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
              mode,
            })
          : evaluateEquityCandidate({
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
            item.momentum,
            item.prefilterQuality
          );

        finalCandidates.push(
          signal
        );
      }
    }
  } else if (
    !state.marketOpen &&
    !allowExtendedEquities
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

  await seedRejectedOpportunityOutcomes(
    mode,
    state.nearMisses
  );

  await updateRejectedOpportunityOutcomes(
    mode
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
  recordRejectionSnapshot(
    mode,
    state.scanDiagnostics,
    state.nearMisses,
    state.topCandidates
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

  const exitDecisionPrice =
    Number(
      trade
        .exit_decision_price
    );

  const exitSlippageBps =
    Number.isFinite(
      exitDecisionPrice
    ) &&
    exitDecisionPrice >
      0
      ? (
          direction ===
          'SHORT'
            ? (
                exitPrice -
                exitDecisionPrice
              ) /
              exitDecisionPrice
            : (
                exitDecisionPrice -
                exitPrice
              ) /
              exitDecisionPrice
        ) *
        10000
      : null;

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

    exit_slippage_bps:
      Number.isFinite(
        exitSlippageBps
      )
        ? Number(
            exitSlippageBps
              .toFixed(
                4
              )
          )
        : null,

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

          exit_decision_price:
            Number.isFinite(
              Number(
                price
              )
            )
              ? Number(
                  price
                )
              : null,
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
          (
            !String(latest.market)
              .includes('/') &&
            extendedEquityAllowed(mode)
          )
            ? 'limit'
            : 'market',

        limitPrice:
          (
            !String(latest.market)
              .includes('/') &&
            extendedEquityAllowed(mode)
          )
            ? extendedLimitPrice(
                Number(
                  latest.exit_decision_price ??
                  latest.current_price ??
                  latest.entry_price
                ),
                side
              )
            : undefined,

        extendedHours:
          (
            !String(latest.market)
              .includes('/') &&
            extendedEquityAllowed(mode)
          )
            ? true
            : undefined,

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

  const entryBuyingPowerFraction =
    buyingPowerFraction();

  const buyingPowerCap =
    buyingPower *
    entryBuyingPowerFraction;

  const positionBudget =
    Math.min(
      riskSizedNotional,
      equityCap,
      buyingPowerCap
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

    buyingPowerCap,

    entryBuyingPowerFraction,

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

  if (
    Date.now() <
    entryBuyingPowerCooldownUntil
  ) {
    const waitSeconds =
      Math.max(
        1,
        Math.ceil(
          (
            entryBuyingPowerCooldownUntil -
            Date.now()
          ) /
          1000
        )
      );

    state.lastDecision =
      `${mode.toUpperCase()} new entries cooling down ${waitSeconds}s` +
      (
        entryBuyingPowerCooldownSymbol
          ? ` after buying-power rejection on ${entryBuyingPowerCooldownSymbol}`
          : ' after buying-power rejection'
      );

    return false;
  }

  if (
    entryBuyingPowerCooldownUntil > 0 &&
    Date.now() >=
      entryBuyingPowerCooldownUntil
  ) {
    entryBuyingPowerCooldownUntil = 0;
    entryBuyingPowerCooldownSymbol = null;
  }

  const best =
    await scan(
      mode
    );

  if (!best) {
    const strategyEquity =
      state
        .scanDiagnostics
        ?.topStrategyRejections
        ?.equities
        ?.[0];

    const strategyCrypto =
      state
        .scanDiagnostics
        ?.topStrategyRejections
        ?.crypto
        ?.[0];

    const prefilterEquity =
      state
        .scanDiagnostics
        ?.topPrefilterRejections
        ?.equities
        ?.[0];

    const prefilterCrypto =
      state
        .scanDiagnostics
        ?.topPrefilterRejections
        ?.crypto
        ?.[0];

    const top =
      strategyEquity ||
      strategyCrypto ||
      prefilterEquity ||
      prefilterCrypto;

    state.lastDecision =
      `${mode.toUpperCase()} scanning ` +
      `${state.universe.equities.length + state.universe.crypto.length} ` +
      `Alpaca tradable assets — ${state.openTradeIds.length}/` +
      `${maxOpenPositions()} positions open — waiting for v20 setup` +
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

  try {
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
          extendedEquityAllowed(mode)
            ? 'limit'
            : 'market',

        limitPrice:
          extendedEquityAllowed(mode)
            ? extendedLimitPrice(
                best.price,
                'sell'
              )
            : undefined,

        extendedHours:
          extendedEquityAllowed(mode)
            ? true
            : undefined,

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
          extendedEquityAllowed(mode)
            ? 'limit'
            : 'market',

        limitPrice:
          extendedEquityAllowed(mode)
            ? extendedLimitPrice(
                best.price,
                'buy'
              )
            : undefined,

        extendedHours:
          extendedEquityAllowed(mode)
            ? true
            : undefined,

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
  } catch (error) {
    if (
      isBuyingPowerEntryError(
        error
      )
    ) {
      const cooldownMs =
        Math.max(
          10000,
          Number(
            cfg()
              .entryBuyingPowerRejectCooldownMs ||
            60000
          )
        );

      entryBuyingPowerCooldownUntil =
        Date.now() +
        cooldownMs;

      entryBuyingPowerCooldownSymbol =
        best.symbol;

      state.lastError =
        null;

      state.lastDecision =
        `${mode.toUpperCase()} ${direction} ${best.symbol} skipped — ` +
        `Alpaca buying-power rejection; bot keeps running — ` +
        `new-entry cooldown ${Math.ceil(cooldownMs / 1000)}s`;

      console.warn(
        `[${mode}-bot] ${state.lastDecision}: ${error.message}`
      );

      return false;
    }

    throw error;
  }

  entryBuyingPowerCooldownUntil = 0;
  entryBuyingPowerCooldownSymbol = null;

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

  const signalPrice =
    Number(
      best.price
    );

  const entrySlippageBps =
    Number.isFinite(
      signalPrice
    ) &&
    signalPrice >
      0
      ? (
          direction ===
          'SHORT'
            ? (
                signalPrice -
                entryPrice
              ) /
              signalPrice
            : (
                entryPrice -
                signalPrice
              ) /
              signalPrice
        ) *
        10000
      : null;

  const actualEntryNotional =
    entryPrice *
    filledQty;

  const plannedBudget =
    Number(
      sizing.positionBudget
    );

  const plannedBudgetFilledPct =
    Number.isFinite(
      plannedBudget
    ) &&
    plannedBudget >
      0
      ? (
          actualEntryNotional /
          plannedBudget
        ) *
        100
      : null;

  const entryExposurePct =
    Number.isFinite(
      equity
    ) &&
    equity >
      0
      ? (
          actualEntryNotional /
          equity
        ) *
        100
      : null;

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

      signal_price:
        Number.isFinite(
          signalPrice
        )
          ? signalPrice
          : null,

      entry_slippage_bps:
        Number.isFinite(
          entrySlippageBps
        )
          ? Number(
              entrySlippageBps
                .toFixed(
                  4
                )
            )
          : null,

      actual_entry_notional:
        Number(
          actualEntryNotional
            .toFixed(
              4
            )
        ),

      planned_budget_filled_pct:
        Number.isFinite(
          plannedBudgetFilledPct
        )
          ? Number(
              plannedBudgetFilledPct
                .toFixed(
                  4
                )
            )
          : null,

      entry_exposure_pct:
        Number.isFinite(
          entryExposurePct
        )
          ? Number(
              entryExposurePct
                .toFixed(
                  4
                )
            )
          : null,

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
// ========================================
// STRATEGY REJECTION LOG
// ========================================

router.get(
  '/rejection-log',

  (
    req,
    res
  ) => {
    const limit =
      Math.max(
        1,
        Math.min(
          500,
          Number(
            req.query.limit ||
            100
          )
        )
      );

    res.json(
      readRejectionLog(
        limit
      )
    );
  }
);

router.delete(
  '/rejection-log',

  (
    req,
    res
  ) => {
    store.saveAll(
      'rejectionLog',
      []
    );

    res.json({
      ok: true,
    });
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
