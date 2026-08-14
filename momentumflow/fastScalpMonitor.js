import { store } from './store.js';
import { getCryptoSnapshots } from './alpacaClient.js';
import { minuteMomentumPct } from './strategyEngine.js';

const DEFAULTS = {
  fastScalpReversalMomentumPct: -0.08,
  fastScalpFadeMomentumPct: 0.02,
  fastScalpCostLockPct: 0.60,
};

let timer = null;
let busy = false;

function snapshotFor(snapshots, symbol) {
  const compact = String(symbol || '').replace('/', '');
  return snapshots?.[symbol] || snapshots?.[compact] || null;
}

function currentPrice(snapshot) {
  return Number(
    snapshot?.latestTrade?.p ??
    snapshot?.minuteBar?.c ??
    snapshot?.dailyBar?.c
  );
}

function markPendingExit(trade, reason) {
  const latest = store.getOne('trades', trade.id);
  if (
    !latest ||
    latest.result !== null ||
    latest.pending_exit_reason
  ) {
    return;
  }

  store.update('trades', trade.id, {
    pending_exit_reason: reason,
    pending_exit_started_at: new Date().toISOString(),
    fast_scalp_exit_signal_at: new Date().toISOString(),
  });

  console.log(`[fast-scalp] ${trade.market}: ${reason}`);
}

async function checkFastScalps() {
  if (busy) return;
  busy = true;

  try {
    const mode = store.getConfig(
      'tradingMode',
      { mode: 'paper' }
    ).mode;

    const tradingConfig = store.getConfig(
      'tradingConfig',
      {}
    );

    // Hard PAPER-only gate.
    if (
      mode !== 'paper' ||
      tradingConfig.fastScalpEnabled !== true
    ) {
      return;
    }

    const open = store
      .getAll('trades')
      .filter(
        (trade) =>
          trade.result === null &&
          trade.asset_class === 'crypto' &&
          trade.strategy_name === 'CRYPTO_FAST_SCALP' &&
          !trade.pending_exit_reason
      );

    if (!open.length) return;

    const symbols = [
      ...new Set(open.map((trade) => trade.market)),
    ];

    const snapshots = await getCryptoSnapshots(
      'paper',
      symbols
    );

    const config = {
      ...DEFAULTS,
      ...store.getConfig('strategyConfig', {}),
    };

    for (const trade of open) {
      const snapshot = snapshotFor(
        snapshots,
        trade.market
      );

      if (!snapshot) continue;

      const momentum = minuteMomentumPct(snapshot);
      const price = currentPrice(snapshot);
      const entry = Number(trade.entry_price);

      if (
        momentum != null &&
        momentum <=
          Number(config.fastScalpReversalMomentumPct)
      ) {
        markPendingExit(
          trade,
          `FAST SCALP 1m reversal ${momentum.toFixed(3)}%`
        );
        continue;
      }

      if (
        Number.isFinite(price) &&
        Number.isFinite(entry) &&
        entry > 0 &&
        momentum != null
      ) {
        const grossMove =
          ((price - entry) / entry) * 100;

        if (
          grossMove >=
            Number(config.fastScalpCostLockPct) &&
          momentum <=
            Number(config.fastScalpFadeMomentumPct)
        ) {
          markPendingExit(
            trade,
            `FAST SCALP momentum fade after +${grossMove.toFixed(3)}%; 1m ${momentum.toFixed(3)}%`
          );
        }
      }
    }
  } catch (error) {
    console.warn(
      `[fast-scalp-monitor] ${error.message}`
    );
  } finally {
    busy = false;
  }
}

export function startFastScalpMonitor() {
  if (timer) return;

  timer = setInterval(
    checkFastScalps,
    5000
  );

  timer.unref?.();

  setTimeout(
    checkFastScalps,
    1500
  ).unref?.();

  console.log(
    '[fast-scalp] PAPER-only reversal monitor active.'
  );
}
