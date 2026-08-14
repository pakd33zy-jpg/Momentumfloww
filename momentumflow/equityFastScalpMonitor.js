import { store } from './store.js';
import { getStockSnapshots } from './alpacaClient.js';

let timer = null;
let busy = false;

const DEFAULTS = {
  equityFastScalpReversalMomentumPct: 0.05,
  equityFastScalpFadeMomentumPct: 0.01,
  equityFastScalpCostLockPct: 0.25,
};

function minuteMomentumPct(snapshot) {
  const open = Number(
    snapshot?.minuteBar?.o
  );

  const close = Number(
    snapshot?.minuteBar?.c ??
    snapshot?.latestTrade?.p
  );

  if (
    !Number.isFinite(open) ||
    !Number.isFinite(close) ||
    open <= 0
  ) {
    return null;
  }

  return (
    (
      close -
      open
    ) /
    open
  ) * 100;
}

function currentPrice(snapshot) {
  return Number(
    snapshot?.latestTrade?.p ??
    snapshot?.minuteBar?.c ??
    snapshot?.dailyBar?.c
  );
}

function markPendingExit(
  trade,
  reason
) {
  const latest =
    store.getOne(
      'trades',
      trade.id
    );

  if (
    !latest ||
    latest.result !== null ||
    latest.pending_exit_reason
  ) {
    return;
  }

  store.update(
    'trades',
    trade.id,
    {
      pending_exit_reason:
        reason,
      pending_exit_started_at:
        new Date()
          .toISOString(),
      fast_equity_scalp_exit_signal_at:
        new Date()
          .toISOString(),
    }
  );

  console.log(
    `[equity-fast-scalp] ${trade.market}: ${reason}`
  );
}

async function check() {
  if (busy) return;

  busy = true;

  try {
    const mode =
      store.getConfig(
        'tradingMode',
        { mode: 'paper' }
      ).mode;

    const tradingConfig =
      store.getConfig(
        'tradingConfig',
        {}
      );

    if (
      mode !== 'paper' ||
      tradingConfig
        .equityFastScalpEnabled !==
        true
    ) {
      return;
    }

    const open =
      store
        .getAll('trades')
        .filter(
          (trade) =>
            trade.result === null &&
            trade.asset_class ===
              'us_equity' &&
            trade.strategy_name ===
              'EQUITY_FAST_SCALP_V20' &&
            !trade
              .pending_exit_reason
        );

    if (!open.length) {
      return;
    }

    const symbols = [
      ...new Set(
        open.map(
          (trade) =>
            trade.market
        )
      ),
    ];

    const liveBotConfig =
      store.getConfig(
        'liveBotConfig',
        {}
      );

    const snapshots =
      await getStockSnapshots(
        'paper',
        symbols,
        {
          feed:
            liveBotConfig
              .stockFeed ||
            'iex',
        }
      );

    const strategyConfig = {
      ...DEFAULTS,
      ...store.getConfig(
        'strategyConfig',
        {}
      ),
      ...tradingConfig,
    };

    for (const trade of open) {
      const snapshot =
        snapshots[
          trade.market
        ];

      if (!snapshot) {
        continue;
      }

      const momentum =
        minuteMomentumPct(
          snapshot
        );

      const price =
        currentPrice(
          snapshot
        );

      const entry =
        Number(
          trade.entry_price
        );

      if (
        momentum == null ||
        !Number.isFinite(price) ||
        !Number.isFinite(entry) ||
        entry <= 0
      ) {
        continue;
      }

      const direction =
        trade.direction ===
          'SHORT'
          ? 'SHORT'
          : 'LONG';

      const favorableMomentum =
        direction === 'SHORT'
          ? -momentum
          : momentum;

      const grossMove =
        direction === 'SHORT'
          ? (
              (
                entry -
                price
              ) /
              entry
            ) *
            100
          : (
              (
                price -
                entry
              ) /
              entry
            ) *
            100;

      const reversal =
        Math.max(
          0,
          Number(
            strategyConfig
              .equityFastScalpReversalMomentumPct ??
            0.05
          )
        );

      if (
        favorableMomentum <=
          -reversal
      ) {
        markPendingExit(
          trade,
          `FAST EQUITY SCALP ${direction} reversal; favorable 1m momentum ${favorableMomentum.toFixed(3)}%`
        );
        continue;
      }

      const lock =
        Number(
          strategyConfig
            .equityFastScalpCostLockPct ??
          0.25
        );

      const fade =
        Number(
          strategyConfig
            .equityFastScalpFadeMomentumPct ??
          0.01
        );

      if (
        grossMove >= lock &&
        favorableMomentum <=
          fade
      ) {
        markPendingExit(
          trade,
          `FAST EQUITY SCALP ${direction} fade after +${grossMove.toFixed(3)}%; favorable 1m ${favorableMomentum.toFixed(3)}%`
        );
      }
    }
  } catch (error) {
    console.warn(
      `[equity-fast-scalp-monitor] ${error.message}`
    );
  } finally {
    busy = false;
  }
}

export function startEquityFastScalpMonitor() {
  if (timer) return;

  timer = setInterval(
    check,
    5000
  );

  timer.unref?.();

  setTimeout(
    check,
    1500
  ).unref?.();

  console.log(
    '[equity-fast-scalp] PAPER-only reversal monitor active.'
  );
}
