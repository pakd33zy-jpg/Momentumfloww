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
  getLatestTradablePrice,
  hasCredentials,
  placeOrder,
  waitForFill,
} from './alpacaClient.js';

// LIVE BOT v11
// Equities: LONG + SHORT
// Crypto: LONG only

const router = express.Router();

const state = {
  running: false,
  timer: null,
  sessionId: null,
  startedAt: null,
  lastTickAt: null,
  lastError: null,
  openTradeId: null,
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
  equityBatchSize: 75,
  universeRefreshMinutes: 15,
  minEquityPrice: 1,
  minDailyDollarVolume: 1000000,
  stockFeed: 'iex',
};

const tradingCfg = () => ({
  startingCapital: 100,
  riskPerTrade: 0.02,
  ...store.getConfig('tradingConfig', {}),
});

const cfg = () => ({
  ...DEFAULTS,
  ...store.getConfig('liveBotConfig', {}),
});

function gate() {
  return evaluateLiveGate({
    consents: store.getConfig(
      'liveGateConsents',
      {}
    ),
    hasLiveCredentials:
      hasCredentials('live'),
  });
}

function pub() {
  return {
    running: state.running,
    sessionId: state.sessionId,
    startedAt: state.startedAt,
    lastTickAt: state.lastTickAt,
    lastError: state.lastError,
    openTradeId: state.openTradeId,
    lastDecision: state.lastDecision,
    signalSnapshot: state.signalSnapshot,
    topCandidates: state.topCandidates,
    marketOpen: state.marketOpen,

    universe: {
      equityCount:
        state.universe.equities.length,
      cryptoCount:
        state.universe.crypto.length,
      totalCount:
        state.universe.equities.length +
        state.universe.crypto.length,
      refreshedAt:
        state.universe.refreshedAt,
      equityCursor:
        state.equityCursor,
    },

    config: {
      ...cfg(),
      riskPerTrade: Number(
        tradingCfg().riskPerTrade ?? 0.02
      ),
      sizingMode:
        'equity_risk_fraction',
      equityDirections:
        'LONG_AND_SHORT',
      cryptoDirections:
        'LONG_ONLY',
    },
  };
}

function stop(reason = null) {
  if (state.timer) {
    clearTimeout(state.timer);
  }

  state.timer = null;
  state.running = false;

  if (reason) {
    state.lastError = reason;
  }
}

function schedule() {
  if (!state.running) return;

  state.timer = setTimeout(
    tick,
    Math.max(
      2,
      Number(cfg().pollSeconds)
    ) * 1000
  );
}

function normPos(symbol = '') {
  if (symbol.includes('/')) {
    return symbol;
  }

  if (/^[A-Z]+USD$/.test(symbol)) {
    return `${symbol.slice(0, -3)}/USD`;
  }

  return symbol;
}

async function refreshUniverse(
  force = false
) {
  const c = cfg();

  const age =
    state.universe.refreshedAt
      ? Date.now() -
        new Date(
          state.universe.refreshedAt
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
    await getTradableAssets('live');

  state.universe = {
    equities:
      assets.equities || [],
    crypto:
      assets.crypto || [],
    refreshedAt:
      new Date().toISOString(),
  };

  if (
    state.equityCursor >=
    state.universe.equities.length
  ) {
    state.equityCursor = 0;
  }
}

function momentum(snapshot) {
  const bar = snapshot?.minuteBar;

  const open = Number(bar?.o);

  const close = Number(
    bar?.c ??
      snapshot?.latestTrade?.p
  );

  if (
    !Number.isFinite(open) ||
    !Number.isFinite(close) ||
    open <= 0
  ) {
    return null;
  }

  return {
    momentumPct:
      ((close - open) / open) *
      100,

    price: close,

    volume: Number(
      snapshot?.dailyBar?.v || 0
    ),
  };
}

async function scan() {
  await refreshUniverse();

  const c = cfg();

  const session = store.getOne(
    'sessions',
    state.sessionId
  );

  if (!session) {
    throw new Error(
      'Live bot session was not found.'
    );
  }

  const trades = store
    .getAll('trades')
    .filter(
      (trade) =>
        trade.session_id ===
        session.id
    );

  const positions =
    await getPositions('live');

  const blocked = new Set(
    positions
      .filter(
        (position) =>
          Math.abs(
            Number(
              position.qty || 0
            )
          ) > 0
      )
      .map((position) =>
        normPos(position.symbol)
      )
  );

  const candidates = [];

  const snapshotOutput = {};

  /*
   * CRYPTO
   *
   * Long only.
   */
  const cryptoSymbols =
    state.universe.crypto
      .map((asset) => asset.symbol)
      .filter(Boolean);

  if (cryptoSymbols.length) {
    const snapshots =
      await getCryptoSnapshots(
        'live',
        cryptoSymbols
      );

    for (
      const asset of
      state.universe.crypto
    ) {
      const snapshot =
        snapshots[asset.symbol] ||
        snapshots[
          asset.symbol?.replace(
            '/',
            ''
          )
        ];

      const m =
        momentum(snapshot);

      if (!m) continue;

      const eligible =
        !blocked.has(
          asset.symbol
        ) &&
        canTradeMarket(
          trades,
          asset.symbol
        );

      snapshotOutput[
        asset.symbol
      ] = {
        assetClass: 'crypto',
        direction: 'LONG',
        momentumPct: Number(
          m.momentumPct.toFixed(4)
        ),
        thresholdPct: Number(
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
          symbol: asset.symbol,
          name:
            asset.name ||
            asset.symbol,
          assetClass: 'crypto',
          direction: 'LONG',
          score: Math.abs(
            m.momentumPct
          ),
          ...m,
        });
      }
    }
  }

  /*
   * EQUITIES
   *
   * Long positive momentum.
   * Short negative momentum only
   * when Alpaca reports the stock
   * as shortable + easy to borrow.
   */
  const clock =
    await getMarketClock('live');

  state.marketOpen = Boolean(
    clock?.is_open
  );

  if (
    state.marketOpen &&
    state.universe.equities.length
  ) {
    const count = Math.min(
      Number(c.equityBatchSize),
      state.universe.equities
        .length
    );

    const batch = [];

    for (
      let i = 0;
      i < count;
      i++
    ) {
      const index =
        (state.equityCursor +
          i) %
        state.universe.equities
          .length;

      batch.push(
        state.universe.equities[
          index
        ]
      );
    }

    state.equityCursor =
      (state.equityCursor +
        count) %
      state.universe.equities
        .length;

    const snapshots =
      await getStockSnapshots(
        'live',
        batch.map(
          (asset) =>
            asset.symbol
        ),
        {
          feed: c.stockFeed,
        }
      );

    for (
      const asset of batch
    ) {
      const m = momentum(
        snapshots[asset.symbol]
      );

      if (!m) continue;

      if (
        m.price <
        Number(
          c.minEquityPrice
        )
      ) {
        continue;
      }

      const dollarVolume =
        m.price * m.volume;

      const baseEligible =
        dollarVolume >=
          Number(
            c.minDailyDollarVolume
          ) &&
        !blocked.has(
          asset.symbol
        ) &&
        canTradeMarket(
          trades,
          asset.symbol
        );

      const shortEligible =
        baseEligible &&
        asset.shortable === true &&
        asset.easy_to_borrow ===
          true;

      let direction = null;

      if (
        baseEligible &&
        m.momentumPct >=
          Number(
            c.entryMomentumPct
          )
      ) {
        direction = 'LONG';
      } else if (
        shortEligible &&
        m.momentumPct <=
          -Number(
            c.entryMomentumPct
          )
      ) {
        direction = 'SHORT';
      }

      snapshotOutput[
        asset.symbol
      ] = {
        assetClass:
          'us_equity',
        momentumPct: Number(
          m.momentumPct.toFixed(4)
        ),
        thresholdPct: Number(
          c.entryMomentumPct
        ),
        eligible:
          baseEligible,
        shortable:
          asset.shortable === true,
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
          symbol: asset.symbol,

          name:
            asset.name ||
            asset.symbol,

          assetClass:
            'us_equity',

          direction,

          score: Math.abs(
            m.momentumPct
          ),

          dollarVolume,

          ...m,
        });
      }
    }
  }

  /*
   * Strongest absolute momentum
   * wins regardless of direction.
   */
  candidates.sort(
    (a, b) =>
      b.score - a.score
  );

  state.signalSnapshot =
    Object.fromEntries(
      Object.entries(
        snapshotOutput
      ).slice(-25)
    );

  state.topCandidates =
    candidates
      .slice(0, 10)
      .map((candidate) => ({
        symbol:
          candidate.symbol,

        assetClass:
          candidate.assetClass,

        direction:
          candidate.direction,

        momentumPct:
          Number(
            candidate.momentumPct.toFixed(
              4
            )
          ),

        price:
          Number(
            candidate.price.toFixed(
              6
            )
          ),
      }));

  return candidates[0] || null;
}

async function closeTrade(
  trade,
  price,
  reason
) {
  const qty = Number(
    trade.filled_qty ||
      trade.qty
  );

  if (
    !Number.isFinite(qty) ||
    qty <= 0
  ) {
    throw new Error(
      'Open trade has no filled quantity to close.'
    );
  }

  const direction =
    trade.direction === 'SHORT'
      ? 'SHORT'
      : 'LONG';

  const crypto =
    trade.asset_class ===
      'crypto' ||
    String(
      trade.market
    ).includes('/');

  /*
   * Close LONG = SELL
   * Close SHORT = BUY TO COVER
   */
  const exitSide =
    direction === 'SHORT'
      ? 'buy'
      : 'sell';

  const order =
    await placeOrder({
      mode: 'live',
      symbol: trade.market,
      qty,
      side: exitSide,
      type: 'market',
      timeInForce: crypto
        ? 'gtc'
        : 'day',
    });

  const fill =
    await waitForFill(
      'live',
      order.id
    );

  if (
    fill.status !== 'filled'
  ) {
    throw new Error(
      `Exit order ${order.id} was not filled (status: ${fill.status}).`
    );
  }

  const exitPrice = Number(
    fill.filled_avg_price ||
      price
  );

  const entryPrice = Number(
    trade.entry_price
  );

  const filledQty = Number(
    fill.filled_qty || qty
  );

  /*
   * LONG:
   * exit - entry
   *
   * SHORT:
   * entry - exit
   */
  const pnl =
    direction === 'SHORT'
      ? (entryPrice -
          exitPrice) *
        filledQty
      : (exitPrice -
          entryPrice) *
        filledQty;

  const result =
    pnl >= 0
      ? 'win'
      : 'loss';

  const allTrades =
    store.getAll('trades');

  const index =
    allTrades.findIndex(
      (item) =>
        item.id === trade.id
    );

  if (index >= 0) {
    allTrades[index] = {
      ...allTrades[index],

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
        order.id,

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
            session.consecutive_losses ||
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

  state.openTradeId = null;
}

async function manage() {
  if (!state.openTradeId) {
    return false;
  }

  const trade = store.getOne(
    'trades',
    state.openTradeId
  );

  if (
    !trade ||
    trade.result !== null
  ) {
    state.openTradeId =
      null;

    return false;
  }

  const direction =
    trade.direction === 'SHORT'
      ? 'SHORT'
      : 'LONG';

  state.lastDecision =
    `managing ${direction} ${trade.market}`;

  const assetClass =
    trade.asset_class ||
    (String(
      trade.market
    ).includes('/')
      ? 'crypto'
      : 'us_equity');

  const price =
    await getLatestTradablePrice(
      'live',
      trade.market,
      assetClass
    );

  const entryPrice = Number(
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
    ((price - entryPrice) /
      entryPrice) *
    100;

  /*
   * Positive favorableMove means
   * the position is profitable,
   * regardless of LONG/SHORT.
   */
  const favorableMove =
    direction === 'SHORT'
      ? -rawMove
      : rawMove;

  const ageMinutes =
    (Date.now() -
      new Date(
        trade.timestamp ||
          trade.created_at
      ).getTime()) /
    60000;

  const c = cfg();

  if (
    favorableMove >=
    Number(
      c.takeProfitPct
    )
  ) {
    await closeTrade(
      trade,
      price,
      `${direction} take profit +${favorableMove.toFixed(
        3
      )}%`
    );
  } else if (
    favorableMove <=
    -Number(
      c.stopLossPct
    )
  ) {
    await closeTrade(
      trade,
      price,
      `${direction} stop loss ${favorableMove.toFixed(
        3
      )}%`
    );
  } else if (
    ageMinutes >=
    Number(
      c.maxHoldMinutes
    )
  ) {
    await closeTrade(
      trade,
      price,
      `${direction} max hold ${ageMinutes.toFixed(
        1
      )}m`
    );
  }

  return true;
}

async function enter() {
  const session =
    store.getOne(
      'sessions',
      state.sessionId
    );

  if (!session) {
    throw new Error(
      'Live bot session was not found.'
    );
  }

  const halt =
    checkHaltConditions(
      session
    );

  if (halt.halt) {
    store.update(
      'sessions',
      session.id,
      {
        status: 'halted',

        halt_reason:
          halt.reason,

        completed_at:
          new Date().toISOString(),
      }
    );

    stop(
      `Safety halt: ${halt.reason}`
    );

    return;
  }

  const best = await scan();

  if (!best) {
    state.lastDecision =
      `scanning ${
        state.universe.equities
          .length +
        state.universe.crypto
          .length
      } Alpaca tradable assets — waiting for LONG or SHORT momentum signal`;

    return;
  }

  const direction =
    best.direction ||
    'LONG';

  state.lastDecision =
    `${direction} signal ${
      best.symbol
    } ${
      best.momentumPct >= 0
        ? '+'
        : ''
    }${best.momentumPct.toFixed(
      4
    )}%`;

  const account =
    await getAccount('live');

  const buyingPower =
    Number(
      account.buying_power ||
        account.cash ||
        0
    );

  const equity = Number(
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
    equity * riskFraction;

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
      'Insufficient live buying power for the configured risk-based trade size.'
    );
  }

  let order;

  /*
   * SHORT EQUITY
   *
   * Whole shares only.
   */
  if (
    direction === 'SHORT'
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

    /*
     * Do not exceed the configured
     * risk budget just to force a
     * short trade.
     */
    if (qty < 1) {
      state.lastDecision =
        `SHORT signal ${best.symbol} skipped — risk budget $${riskBudget.toFixed(
          2
        )} is below one whole share at $${best.price.toFixed(
          2
        )}`;

      return;
    }

    state.lastDecision =
      `SHORT signal ${
        best.symbol
      } ${best.momentumPct.toFixed(
        4
      )}% · ${
        qty
      } whole share${
        qty === 1 ? '' : 's'
      } · risk budget $${riskBudget.toFixed(
        2
      )}`;

    order =
      await placeOrder({
        mode: 'live',
        symbol:
          best.symbol,
        qty,
        side: 'sell',
        type: 'market',
        timeInForce:
          'day',
      });
  } else {
    /*
     * LONG ENTRY
     *
     * Fractional notional sizing
     * remains available.
     */
    state.lastDecision =
      `LONG signal ${
        best.symbol
      } +${best.momentumPct.toFixed(
        4
      )}% · sizing $${riskBudget.toFixed(
        2
      )} (${(
        riskFraction * 100
      ).toFixed(
        2
      )}% of equity)`;

    order =
      await placeOrder({
        mode: 'live',
        symbol:
          best.symbol,

        notional:
          Number(
            riskBudget.toFixed(
              2
            )
          ),

        side: 'buy',

        type: 'market',

        timeInForce:
          best.assetClass ===
          'crypto'
            ? 'gtc'
            : 'day',
      });
  }

  const fill =
    await waitForFill(
      'live',
      order.id
    );

  if (
    fill.status !== 'filled'
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

      alpaca_order_id:
        order.id,

      qty:
        Number(
          fill.filled_qty
        ),

      filled_qty:
        Number(
          fill.filled_qty
        ),

      entry_signal: {
        direction,

        momentum_pct:
          Number(
            best.momentumPct.toFixed(
              4
            )
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

  state.openTradeId =
    trade.id;

  state.lastDecision =
    `entered ${direction} ${best.symbol} at ${entryPrice}`;
}

async function tick() {
  if (!state.running) {
    return;
  }

  try {
    const currentGate =
      gate();

    if (
      !currentGate.allowed
    ) {
      stop(
        `Live Gate closed while bot was running: ${currentGate.reason}`
      );

      return;
    }

    const mode =
      store.getConfig(
        'tradingMode',
        {
          mode: 'paper',
        }
      ).mode;

    if (mode !== 'live') {
      stop(
        'Trading mode changed away from live.'
      );

      return;
    }

    state.lastTickAt =
      new Date().toISOString();

    state.lastError = null;

    const managing =
      await manage();

    if (
      !managing &&
      !state.openTradeId
    ) {
      await enter();
    }
  } catch (error) {
    console.error(
      '[live-bot]',
      error
    );

    state.lastError =
      error.message;

    state.lastDecision =
      `stopped on error: ${error.message}`;

    stop(error.message);
  } finally {
    schedule();
  }
}

router.get(
  '/status',
  (req, res) => {
    res.json(pub());
  }
);

router.post(
  '/start',
  async (req, res) => {
    try {
      if (state.running) {
        return res
          .status(409)
          .json({
            error:
              'Live bot is already running.',
            ...pub(),
          });
      }

      const currentGate =
        gate();

      if (
        !currentGate.allowed
      ) {
        return res
          .status(403)
          .json({
            error:
              `Live bot blocked: ${currentGate.reason}`,
          });
      }

      const mode =
        store.getConfig(
          'tradingMode',
          {
            mode: 'paper',
          }
        ).mode;

      if (mode !== 'live') {
        return res
          .status(403)
          .json({
            error:
              'Switch Trading Mode to live before starting the live bot.',
          });
      }

      const account =
        await getAccount(
          'live'
        );

      if (
        account.trading_blocked
      ) {
        return res
          .status(403)
          .json({
            error:
              'Alpaca reports trading_blocked=true for this account.',
          });
      }

      /*
       * Refuse to start if our
       * local records contain an
       * unfinished trade.
       */
      const openTrade =
        store
          .getAll('trades')
          .find(
            (trade) =>
              trade.result ===
              null
          );

      if (openTrade) {
        return res
          .status(409)
          .json({
            error:
              `Refusing to start while local trade ${openTrade.id} is still marked open.`,
          });
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
          .status(403)
          .json({
            error:
              'Live account has no available equity.',
          });
      }

      await refreshUniverse(
        true
      );

      const session =
        createSession({
          mode: 'live',
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
          running: true,

          sessionId:
            session.id,

          startedAt:
            new Date().toISOString(),

          lastTickAt:
            null,

          lastError:
            null,

          openTradeId:
            null,

          lastDecision:
            `starting — loaded ${
              state.universe
                .equities.length +
              state.universe
                .crypto.length
            } Alpaca tradable assets`,

          signalSnapshot:
            {},

          topCandidates:
            [],
        }
      );

      setImmediate(tick);

      res.json(pub());
    } catch (error) {
      res
        .status(500)
        .json({
          error:
            error.message,
        });
    }
  }
);

router.post(
  '/stop',
  async (req, res) => {
    stop();

    state.lastDecision =
      'stopped by user';

    try {
      /*
       * If the bot itself has an
       * open position, close it
       * using LONG/SHORT-aware
       * closeTrade().
       */
      if (
        state.openTradeId
      ) {
        const trade =
          store.getOne(
            'trades',
            state.openTradeId
          );

        if (
          trade &&
          trade.result ===
            null
        ) {
          const assetClass =
            trade.asset_class ||
            (String(
              trade.market
            ).includes('/')
              ? 'crypto'
              : 'us_equity');

          const price =
            await getLatestTradablePrice(
              'live',
              trade.market,
              assetClass
            );

          await closeTrade(
            trade,
            price,
            'live bot stopped by user'
          );
        }
      }

      if (state.sessionId) {
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
                'Live bot stopped by user',

              completed_at:
                new Date().toISOString(),
            }
          );
        }
      }

      res.json(pub());
    } catch (error) {
      state.lastError =
        `Bot stopped, but open-position close failed: ${error.message}`;

      res
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
