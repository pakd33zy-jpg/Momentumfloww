import express from 'express';
import { getCryptoBars } from './alpacaClient.js';

const router = express.Router();

const BTC = 'BTC/USD';
const TARGETS = ['ETH/USD', 'SOL/USD', 'LINK/USD'];
const COST_PCT = 1.0;

function n(value, fallback = NaN) {
  const x = Number(value);
  return Number.isFinite(x) ? x : fallback;
}

function t(bar) {
  return new Date(bar?.t ?? bar?.timestamp ?? 0).getTime();
}

function px(bar, key) {
  const aliases = { o: 'open', h: 'high', l: 'low', c: 'close' };
  return n(bar?.[key] ?? bar?.[aliases[key]]);
}

function atr(rows, end, length = 14) {
  if (end - length < 0) return NaN;
  let total = 0;
  for (let i = end - length + 1; i <= end; i += 1) {
    const high = px(rows[i], 'h');
    const low = px(rows[i], 'l');
    const previous = px(rows[i - 1], 'c');
    total += Math.max(high - low, Math.abs(high - previous), Math.abs(low - previous));
  }
  return total / length;
}

function structure(rows, end, length = 64) {
  if (end - (2 * length) + 1 < 0) return 0;
  const recent = rows.slice(end - length + 1, end + 1);
  const prior = rows.slice(end - (2 * length) + 1, end - length + 1);
  const recentHigh = Math.max(...recent.map((bar) => px(bar, 'h')));
  const recentLow = Math.min(...recent.map((bar) => px(bar, 'l')));
  const priorHigh = Math.max(...prior.map((bar) => px(bar, 'h')));
  const priorLow = Math.min(...prior.map((bar) => px(bar, 'l')));
  if (recentHigh > priorHigh && recentLow > priorLow) return 1;
  if (recentHigh < priorHigh && recentLow < priorLow) return -1;
  return 0;
}

function regimeAt(signalTime, daily) {
  let end = -1;
  for (let i = 0; i < daily.length; i += 1) {
    // A daily bar is usable only after the following UTC midnight.
    if (t(daily[i]) + 24 * 60 * 60 * 1000 <= signalTime) end = i;
    else break;
  }
  if (end < 150) return { ready: false, pass: false };

  const last = px(daily[end], 'c');
  const smaRows = daily.slice(end - 149, end + 1);
  const sma150 = smaRows.reduce((sum, bar) => sum + px(bar, 'c'), 0) / smaRows.length;
  const momentum63 = last / px(daily[end - 63], 'c') - 1;

  return {
    ready: true,
    pass: last > sma150 && momentum63 > 0,
    btcClose: last,
    sma150,
    momentum63,
    regimeBarTime: new Date(t(daily[end])).toISOString(),
  };
}

function c62Signal(assetRows, assetEnd, btcRows, btcEnd) {
  if (assetEnd < 129 || btcEnd < 129) return null;
  const bar = assetRows[assetEnd];
  const prior = assetRows[assetEnd - 1];
  const close = px(bar, 'c');
  const btcClose = px(btcRows[btcEnd], 'c');
  const assetAtr = atr(assetRows, assetEnd);
  const btcAtr = atr(btcRows, btcEnd);
  if (!(assetAtr > 0) || !(btcAtr > 0) || !(close > 0) || !(btcClose > 0)) return null;

  const btcMove = btcClose / px(btcRows[btcEnd - 8], 'c') - 1;
  const assetMove = close / px(assetRows[assetEnd - 8], 'c') - 1;
  const btcVolatility = btcAtr / btcClose;

  const pass =
    structure(btcRows, btcEnd) === 1 &&
    structure(assetRows, assetEnd) >= 0 &&
    btcVolatility >= 0.004 &&
    btcMove >= 0.006 &&
    assetMove >= 0 &&
    assetMove <= btcMove * 0.5 &&
    close > px(bar, 'o') &&
    close > px(prior, 'h');

  if (!pass) return null;

  return {
    riskPct: (2.5 * assetAtr / close) * 100,
    btcMove,
    assetMove,
    btcVolatility,
  };
}

function simulateTrade(rows, signalIndex, riskPct) {
  const entryIndex = signalIndex + 1;
  if (entryIndex >= rows.length) return null;

  const entry = px(rows[entryIndex], 'o');
  if (!(entry > 0) || !(riskPct > 0)) return null;

  const r = riskPct / 100;
  const stopPrice = entry * (1 - r);
  const targetPrice = entry * (1 + 3.25 * r);
  const addPrice = entry * (1 + r);
  const trailTriggerPct = riskPct * 2.5;
  const trailDistancePct = riskPct * 1.5;

  let peak = entry;
  let added = false;
  const legs = [{ entry, weight: 0.5 }];
  const maxExitIndex = Math.min(rows.length - 1, entryIndex + 96);

  for (let i = entryIndex; i <= maxExitIndex; i += 1) {
    const bar = rows[i];
    const open = px(bar, 'o');
    const high = px(bar, 'h');
    const low = px(bar, 'l');
    const close = px(bar, 'c');

    let effectiveStop = stopPrice;
    const gainFromEntryPct = (peak / entry - 1) * 100;
    if (gainFromEntryPct >= trailTriggerPct) {
      const trailByDistance = peak * (1 - trailDistancePct / 100);
      effectiveStop = Math.max(effectiveStop, trailByDistance, entry);
    }

    const adverseGap = open <= effectiveStop;
    const stopHit = adverseGap || low <= effectiveStop;
    const targetHit = high >= targetPrice;

    if (stopHit) {
      const exit = adverseGap ? open : effectiveStop;
      return finish(legs, exit, i, targetHit ? 'STOP_SAME_BAR' : 'STOP_OR_TRAIL', entryIndex);
    }

    if (targetHit) {
      return finish(legs, targetPrice, i, 'TARGET', entryIndex);
    }

    if (i === maxExitIndex) {
      return finish(legs, close, i, 'MAX_HOLD', entryIndex);
    }

    if (!added && high >= addPrice) {
      legs.push({ entry: addPrice, weight: 0.5 });
      added = true;
    }

    peak = Math.max(peak, high, close);
  }

  return null;
}

function finish(legs, exit, exitIndex, reason, entryIndex) {
  let netReturn = 0;
  for (const leg of legs) {
    netReturn += leg.weight * ((exit / leg.entry - 1) - COST_PCT / 100);
  }
  return {
    netReturn,
    exitIndex,
    entryIndex,
    added: legs.length > 1,
    reason,
  };
}

function summarize(trades) {
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let wins = 0;

  const bySymbol = {};

  for (const trade of trades) {
    const r = n(trade.netReturn, 0);
    equity *= 1 + r;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? 1 - equity / peak : 0);
    if (r > 0) {
      wins += 1;
      grossWin += r;
    } else if (r < 0) {
      grossLoss += Math.abs(r);
    }

    if (!bySymbol[trade.symbol]) {
      bySymbol[trade.symbol] = { trades: 0, equity: 1, grossWin: 0, grossLoss: 0 };
    }
    const s = bySymbol[trade.symbol];
    s.trades += 1;
    s.equity *= 1 + r;
    if (r > 0) s.grossWin += r;
    else if (r < 0) s.grossLoss += Math.abs(r);
  }

  return {
    trades: trades.length,
    returnPct: Number(((equity - 1) * 100).toFixed(2)),
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : (grossWin > 0 ? 999 : 0),
    winRatePct: trades.length ? Number((wins / trades.length * 100).toFixed(1)) : 0,
    maxDrawdownPct: Number((maxDrawdown * 100).toFixed(2)),
    bySymbol: Object.fromEntries(
      Object.entries(bySymbol).map(([symbol, s]) => [
        symbol,
        {
          trades: s.trades,
          returnPct: Number(((s.equity - 1) * 100).toFixed(2)),
          profitFactor: s.grossLoss > 0 ? Number((s.grossWin / s.grossLoss).toFixed(2)) : (s.grossWin > 0 ? 999 : 0),
        },
      ]),
    ),
  };
}

function runWindow({ start, end, barsBySymbol, daily, applyRegime }) {
  const btcRows = barsBySymbol[BTC] || [];
  const btcIndexByTime = new Map(btcRows.map((bar, index) => [t(bar), index]));
  const trades = [];
  let rawSignals = 0;
  let regimeReadySignals = 0;
  let regimePassedSignals = 0;

  for (const symbol of TARGETS) {
    const rows = barsBySymbol[symbol] || [];

    for (let i = 129; i < rows.length - 1; i += 1) {
      const signalTime = t(rows[i]);
      if (signalTime < start.getTime() || signalTime >= end.getTime()) continue;

      const btcEnd = btcIndexByTime.get(signalTime);
      if (!Number.isInteger(btcEnd)) continue;

      const signal = c62Signal(rows, i, btcRows, btcEnd);
      if (!signal) continue;
      rawSignals += 1;

      const regime = regimeAt(signalTime, daily);
      if (regime.ready) regimeReadySignals += 1;
      if (regime.pass) regimePassedSignals += 1;
      if (applyRegime && !regime.pass) continue;

      const trade = simulateTrade(rows, i, signal.riskPct);
      if (!trade) continue;

      trades.push({
        symbol,
        openedAt: new Date(t(rows[trade.entryIndex])).toISOString(),
        signalAt: new Date(signalTime).toISOString(),
        netReturn: trade.netReturn,
        reason: trade.reason,
        added: trade.added,
        regime,
      });

      // One open position per target plus one completed 15m re-entry cooldown.
      i = Math.max(i, trade.exitIndex + 1);
    }
  }

  trades.sort((a, b) => Date.parse(a.signalAt) - Date.parse(b.signalAt));

  return {
    ...summarize(trades),
    rawSignals,
    regimeReadySignals,
    regimePassedSignals,
    regimePassRatePct: regimeReadySignals
      ? Number((regimePassedSignals / regimeReadySignals * 100).toFixed(1))
      : 0,
  };
}

const WINDOWS = {
  older: {
    start: '2024-10-07T00:00:00.000Z',
    end: '2025-10-07T00:00:00.000Z',
  },
  recent: {
    start: '2025-10-08T00:00:00.000Z',
    end: '2026-10-08T00:00:00.000Z',
  },
};

router.get('/backtest', async (req, res) => {
  try {
    const windowId = String(req.query.window || 'recent').toLowerCase();
    const cfg = WINDOWS[windowId];
    if (!cfg) return res.status(400).json({ error: 'window must be older or recent' });

    const start = new Date(cfg.start);
    const end = new Date(cfg.end);
    const warmup15m = new Date(start.getTime() - 3 * 24 * 60 * 60 * 1000);
    const warmupDaily = new Date(start.getTime() - 220 * 24 * 60 * 60 * 1000);

    const symbols = [BTC, ...TARGETS];
    const parts = await Promise.all(
      symbols.map(async (symbol) => {
        const data = await getCryptoBars('paper', [symbol], {
          timeframe: '15Min',
          start: warmup15m,
          end,
          limit: 10000,
          sort: 'asc',
          maxPages: 6,
        });
        return [symbol, data[symbol] || data[symbol.replace('/', '')] || []];
      }),
    );

    const dailyData = await getCryptoBars('paper', [BTC], {
      timeframe: '1Day',
      start: warmupDaily,
      end,
      limit: 10000,
      sort: 'asc',
      maxPages: 2,
    });

    const barsBySymbol = Object.fromEntries(parts);
    const daily = dailyData[BTC] || dailyData[BTC.replace('/', '')] || [];

    const baseline = runWindow({ start, end, barsBySymbol, daily, applyRegime: false });
    const v26Regime = runWindow({ start, end, barsBySymbol, daily, applyRegime: true });

    res.set('Cache-Control', 'no-store');
    return res.json({
      generatedAt: new Date().toISOString(),
      researchOnly: true,
      placesOrders: false,
      strategy: 'C62_FROZEN_ENTRY_EXIT',
      window: windowId,
      start: start.toISOString(),
      end: end.toISOString(),
      ruleUnderTest: 'BTC prior-completed-day close > SMA150 AND 63-day momentum > 0',
      execution: 'Closed 15m C62 signal; next 15m open entry; 1% modeled round-trip cost; same-bar stop priority; 24h max hold.',
      dataCounts: Object.fromEntries(Object.entries(barsBySymbol).map(([symbol, rows]) => [symbol, rows.length])),
      dailyBtcBars: daily.length,
      baseline,
      v26Regime,
    });
  } catch (error) {
    console.error('[c62-regime-research]', error);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
