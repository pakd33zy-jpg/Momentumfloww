import express from 'express';
import { getCryptoBars, getTradableAssets } from './alpacaClient.js';

const router = express.Router();

const BTC = 'BTC/USD';
const TARGETS = ['ETH/USD', 'SOL/USD', 'LINK/USD'];
const COST_PCT = 1.0;
const DAY_MS = 24 * 60 * 60 * 1000;
const BAR_MS = 15 * 60 * 1000;

const WINDOWS = {
  older: { start: '2024-10-07T00:00:00.000Z', end: '2025-10-07T00:00:00.000Z' },
  recent: { start: '2025-10-08T00:00:00.000Z', end: '2026-10-08T00:00:00.000Z' },
};

const VARIANTS = ['baseline', 'trend_cash_hard', 'fast_brake_hard', 'two_stage_hard', 'v4_ready_only', 'v4_cash_only'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function cryptoBarsWithRetry(symbols, options, attempts = 6) {
  const wanted = Array.isArray(symbols) ? symbols : [symbols];
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await getCryptoBars('paper', wanted, options);
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error);
      if (!message.includes('429') || attempt === attempts - 1) throw error;
      await sleep(2500 * (attempt + 1));
    }
  }
  throw lastError;
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

  return pass ? { riskPct: (2.5 * assetAtr / close) * 100 } : null;
}

function stdSample(values) {
  if (values.length < 2) return NaN;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, x) => sum + ((x - mean) ** 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function v31StateAt(signalTime, daily) {
  let end = -1;
  for (let i = 0; i < daily.length; i += 1) {
    if (t(daily[i]) + DAY_MS <= signalTime) end = i;
    else break;
  }
  if (end < 200) return { ready: false };

  const close = px(daily[end], 'c');
  const sma200Rows = daily.slice(end - 199, end + 1);
  const sma200 = sma200Rows.reduce((sum, bar) => sum + px(bar, 'c'), 0) / 200;
  const momentum63 = close / px(daily[end - 63], 'c') - 1;
  const momentum126 = close / px(daily[end - 126], 'c') - 1;

  const logReturns = [];
  for (let i = end - 19; i <= end; i += 1) {
    const previous = px(daily[i - 1], 'c');
    const current = px(daily[i], 'c');
    if (previous > 0 && current > 0) logReturns.push(Math.log(current / previous));
  }
  const vol20Pct = stdSample(logReturns) * Math.sqrt(252) * 100;

  const broken = close < sma200 && momentum126 < 0;
  const fastBroken = close < sma200 && momentum63 < 0;
  const shock = momentum63 < -0.06 || (vol20Pct > 30 && momentum63 < 0);

  return {
    ready: true,
    close,
    sma200,
    momentum63,
    momentum126,
    vol20Pct,
    broken,
    fastBroken,
    shock,
    regimeBarTime: new Date(t(daily[end])).toISOString(),
  };
}

function completedDailyEnd(rows, signalTime) {
  let end = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (t(rows[i]) + DAY_MS <= signalTime) end = i;
    else break;
  }
  return end;
}

function median(values) {
  const x = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!x.length) return NaN;
  const mid = Math.floor(x.length / 2);
  return x.length % 2 ? x[mid] : (x[mid - 1] + x[mid]) / 2;
}

function v4RotationStateAt(signalTime, dailyBySymbol = {}) {
  const btcRows = dailyBySymbol[BTC] || [];
  const btcEnd = completedDailyEnd(btcRows, signalTime);
  if (btcEnd < 150) return { ready: false, reason: 'btc_history' };

  const btcClose = px(btcRows[btcEnd], 'c');
  const btcSma150 = btcRows.slice(btcEnd - 149, btcEnd + 1)
    .reduce((sum, bar) => sum + px(bar, 'c'), 0) / 150;
  const btcMom30 = btcClose / px(btcRows[btcEnd - 30], 'c') - 1;
  const btcUp = btcClose > btcSma150 && btcMom30 > 0.05;

  const ranked = [];
  for (const [symbol, rows] of Object.entries(dailyBySymbol)) {
    const end = completedDailyEnd(rows, signalTime);
    if (end < 150 || end < 63 || end < 29) continue;

    const close = px(rows[end], 'c');
    const prior63 = px(rows[end - 63], 'c');
    if (!(close > 0) || !(prior63 > 0)) continue;

    const sma150 = rows.slice(end - 149, end + 1)
      .reduce((sum, bar) => sum + px(bar, 'c'), 0) / 150;
    const momentum63 = close / prior63 - 1;

    const dollarVolumes = rows.slice(end - 29, end + 1).map((bar) => {
      const c = px(bar, 'c');
      const v = n(bar?.v ?? bar?.volume, NaN);
      return c > 0 && v >= 0 ? c * v : NaN;
    });
    const medianDollarVolume = median(dollarVolumes);
    if (!Number.isFinite(medianDollarVolume)) continue;

    ranked.push({ symbol, momentum63, close, sma150, medianDollarVolume });
  }

  ranked.sort((a, b) => b.medianDollarVolume - a.medianDollarVolume);
  const liquid15 = ranked.slice(0, 15);
  const eligible = liquid15.filter((row) => row.momentum63 > 0 && row.close > row.sma150);
  const breadth = eligible.length;
  const ready = btcUp && breadth >= 4;

  return {
    ready,
    btcUp,
    btcMom30,
    breadth,
    liquidCount: liquid15.length,
    eligibleSymbols: eligible.map((row) => row.symbol),
  };
}

function variantAllows(variant, state, rotationState) {
  if (variant === 'baseline') return true;
  if (variant === 'v4_ready_only') return rotationState?.ready === true;
  if (variant === 'v4_cash_only') return rotationState?.ready === false;
  if (!state?.ready) return false;
  if (variant === 'trend_cash_hard') return !state.broken;
  if (variant === 'fast_brake_hard') return !(state.fastBroken || state.shock);
  if (variant === 'two_stage_hard') return !(state.broken && state.shock);
  throw new Error(`Unknown regime variant: ${variant}`);
}

function finish(legs, exit, exitIndex, reason, entryIndex) {
  const deployedWeight = legs.reduce((sum, leg) => sum + leg.weight, 0);
  if (!(deployedWeight > 0)) return null;
  let weightedReturn = 0;
  for (const leg of legs) {
    weightedReturn += leg.weight * ((exit / leg.entry - 1) - COST_PCT / 100);
  }
  return {
    netReturn: weightedReturn / deployedWeight,
    exitIndex,
    entryIndex,
    added: legs.length > 1,
    reason,
  };
}

function simulateTrade(rows, signalIndex, riskPct) {
  const entryIndex = signalIndex + 1;
  if (entryIndex >= rows.length) return null;
  if (t(rows[entryIndex]) - t(rows[signalIndex]) > BAR_MS + 60_000) return null;

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
      effectiveStop = Math.max(
        effectiveStop,
        peak * (1 - trailDistancePct / 100),
        entry,
      );
    }

    const adverseGap = open <= effectiveStop;
    const stopHit = adverseGap || low <= effectiveStop;
    const targetHit = high >= targetPrice;

    if (stopHit) {
      return finish(
        legs,
        adverseGap ? open : effectiveStop,
        i,
        targetHit ? 'STOP_SAME_BAR' : 'STOP_OR_TRAIL',
        entryIndex,
      );
    }
    if (targetHit) return finish(legs, targetPrice, i, 'TARGET', entryIndex);
    if (i === maxExitIndex) return finish(legs, close, i, 'MAX_HOLD', entryIndex);

    if (!added && high >= addPrice) {
      legs.push({ entry: addPrice, weight: 0.5 });
      added = true;
    }
    peak = Math.max(peak, high, close);
  }
  return null;
}


function simulateAtrTimeTrade(rows, signalIndex, riskPct) {
  const entryIndex = signalIndex + 1;
  if (entryIndex >= rows.length || t(rows[entryIndex]) - t(rows[signalIndex]) > BAR_MS + 60_000) return null;
  const entry = px(rows[entryIndex], 'o');
  if (!(entry > 0) || !(riskPct > 0)) return null;
  const stop = entry * (1 - riskPct / 100);
  const maxExitIndex = Math.min(rows.length - 1, entryIndex + 96);
  for (let i = entryIndex; i <= maxExitIndex; i += 1) {
    const open = px(rows[i], 'o');
    const low = px(rows[i], 'l');
    if (open <= stop || low <= stop) {
      const exit = open <= stop ? open : stop;
      return { netReturn: exit / entry - 1 - COST_PCT / 100, exitIndex: i, entryIndex, reason: 'ATR_STOP' };
    }
    if (i === maxExitIndex) {
      return { netReturn: px(rows[i], 'c') / entry - 1 - COST_PCT / 100, exitIndex: i, entryIndex, reason: 'MAX_HOLD' };
    }
  }
  return null;
}

function runAdaptiveExitSelector({ start, end, barsBySymbol, review = 4, minEdgePct = 1 }) {
  const btcRows = barsBySymbol[BTC] || [];
  const btcIndexByTime = new Map(btcRows.map((bar, index) => [t(bar), index]));
  const candidates = [];
  for (const symbol of TARGETS) {
    const rows = barsBySymbol[symbol] || [];
    for (let i = 129; i < rows.length - 1; i += 1) {
      const signalTime = t(rows[i]);
      if (signalTime < start.getTime() || signalTime >= end.getTime()) continue;
      const btcEnd = btcIndexByTime.get(signalTime);
      if (!Number.isInteger(btcEnd)) continue;
      const signal = c62Signal(rows, i, btcRows, btcEnd);
      if (!signal) continue;
      const c62 = simulateTrade(rows, i, signal.riskPct);
      const atrTime = simulateAtrTimeTrade(rows, i, signal.riskPct);
      if (!c62 || !atrTime) continue;
      candidates.push({
        symbol, signalTime,
        c62: { ...c62, settledAt: t(rows[c62.exitIndex]) },
        atrTime: { ...atrTime, settledAt: t(rows[atrTime.exitIndex]) },
      });
    }
  }
  candidates.sort((a, b) => a.signalTime - b.signalTime);
  const selected = [];
  const blockedUntil = {};
  for (const candidate of candidates) {
    if ((blockedUntil[candidate.symbol] || 0) >= candidate.signalTime) continue;
    const completed = candidates.filter((prior) =>
      prior.signalTime < candidate.signalTime &&
      Math.max(prior.c62.settledAt, prior.atrTime.settledAt) < candidate.signalTime
    ).slice(-review);
    if (completed.length < review) continue;
    const c62Edge = completed.reduce((sum, row) => sum + row.c62.netReturn, 0) / review;
    const atrEdge = completed.reduce((sum, row) => sum + row.atrTime.netReturn, 0) / review;
    const expert = atrEdge > c62Edge ? 'atrTime' : 'c62';
    if (Math.max(c62Edge, atrEdge) * 100 < minEdgePct) continue;
    const outcome = candidate[expert];
    selected.push({ symbol: candidate.symbol, signalAt: new Date(candidate.signalTime).toISOString(), expert, netReturn: outcome.netReturn });
    blockedUntil[candidate.symbol] = outcome.settledAt + BAR_MS;
  }
  return { rawSignals: candidates.length, review, minEdgePct, ...summarize(selected) };
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

    const row = bySymbol[trade.symbol] ||= { trades: 0, equity: 1, grossWin: 0, grossLoss: 0 };
    row.trades += 1;
    row.equity *= 1 + r;
    if (r > 0) row.grossWin += r;
    else if (r < 0) row.grossLoss += Math.abs(r);
  }

  return {
    trades: trades.length,
    returnPct: Number(((equity - 1) * 100).toFixed(3)),
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(3)) : (grossWin > 0 ? 999 : 0),
    winRatePct: trades.length ? Number((wins / trades.length * 100).toFixed(2)) : 0,
    maxDrawdownPct: Number((maxDrawdown * 100).toFixed(3)),
    bySymbol: Object.fromEntries(
      Object.entries(bySymbol).map(([symbol, row]) => [
        symbol,
        {
          trades: row.trades,
          returnPct: Number(((row.equity - 1) * 100).toFixed(3)),
          profitFactor: row.grossLoss > 0
            ? Number((row.grossWin / row.grossLoss).toFixed(3))
            : (row.grossWin > 0 ? 999 : 0),
        },
      ]),
    ),
  };
}

function runVariant({ start, end, barsBySymbol, daily, dailyBySymbol, variant }) {
  const btcRows = barsBySymbol[BTC] || [];
  const btcIndexByTime = new Map(btcRows.map((bar, index) => [t(bar), index]));
  const trades = [];
  let rawSignals = 0;
  let stateReadySignals = 0;
  let rotationReadySignals = 0;
  let allowedRawSignals = 0;

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

      const state = v31StateAt(signalTime, daily);
      const rotationState = v4RotationStateAt(signalTime, dailyBySymbol);
      if (state.ready) stateReadySignals += 1;
      if (rotationState.ready) rotationReadySignals += 1;
      if (!variantAllows(variant, state, rotationState)) continue;
      allowedRawSignals += 1;

      const trade = simulateTrade(rows, i, signal.riskPct);
      if (!trade) continue;

      trades.push({
        symbol,
        signalAt: new Date(signalTime).toISOString(),
        openedAt: new Date(t(rows[trade.entryIndex])).toISOString(),
        netReturn: trade.netReturn,
        reason: trade.reason,
        added: trade.added,
      });

      // Position remains blocked through the exit bar plus one full 15m cooldown bar.
      i = Math.max(i, trade.exitIndex + 1);
    }
  }

  trades.sort((a, b) => Date.parse(a.signalAt) - Date.parse(b.signalAt));

  return {
    ...summarize(trades),
    rawSignals,
    stateReadySignals,
    rotationReadySignals,
    allowedRawSignals,
    rawSignalAllowRatePct: stateReadySignals
      ? Number((allowedRawSignals / stateReadySignals * 100).toFixed(2))
      : 0,
  };
}

async function fetchWindow(start, end) {
  const warmup15m = new Date(start.getTime() - 3 * DAY_MS);
  const warmupDaily = new Date(start.getTime() - 260 * DAY_MS);
  const symbols = [BTC, ...TARGETS];
  const collected = Object.fromEntries(symbols.map((symbol) => [symbol, []]));

  let cursor = new Date(warmup15m);
  const chunkMs = 14 * DAY_MS;
  while (cursor < end) {
    const chunkEnd = new Date(Math.min(end.getTime(), cursor.getTime() + chunkMs));

    // Four symbols x 14 days x 96 fifteen-minute bars/day is ~5,376 rows,
    // safely below Alpaca's 10,000-row page limit. Fetch together so one
    // symbol cannot consume pagination pages needed by the others.
    const data = await cryptoBarsWithRetry(symbols, {
      timeframe: '15Min',
      start: cursor,
      end: chunkEnd,
      limit: 10000,
      sort: 'asc',
      maxPages: 2,
    });

    for (const symbol of symbols) {
      const rows = data[symbol] || data[symbol.replace('/', '')] || [];
      collected[symbol].push(...rows);
    }

    cursor = new Date(chunkEnd);
    await sleep(350);
  }

  for (const symbol of symbols) {
    const deduped = new Map(
      collected[symbol].map((bar) => [t(bar), bar]),
    );
    collected[symbol] = [...deduped.values()].sort((a, b) => t(a) - t(b));
  }

  const assets = await getTradableAssets('paper');
  const dailySymbols = [...new Set([
    BTC,
    ...TARGETS,
    ...(assets?.crypto || []).map((asset) => String(asset?.symbol || '').toUpperCase()).filter(Boolean),
  ])];

  const dailyData = await cryptoBarsWithRetry(dailySymbols, {
    timeframe: '1Day',
    start: warmupDaily,
    end,
    limit: 10000,
    sort: 'asc',
    maxPages: 10,
  });

  const dailyBySymbol = Object.fromEntries(
    dailySymbols.map((symbol) => [
      symbol,
      dailyData[symbol] || dailyData[symbol.replace('/', '')] || [],
    ]),
  );

  return {
    barsBySymbol: collected,
    daily: dailyBySymbol[BTC] || [],
    dailyBySymbol,
  };
}

export async function runC62RegimeWindow(windowId = 'recent') {
  const id = String(windowId || 'recent').toLowerCase();
  const cfg = WINDOWS[id];
  if (!cfg) throw new Error('window must be older or recent');

  const start = new Date(cfg.start);
  const end = new Date(cfg.end);
  const { barsBySymbol, daily, dailyBySymbol } = await fetchWindow(start, end);

  const variants = Object.fromEntries(
    VARIANTS.map((variant) => [
      variant,
      runVariant({ start, end, barsBySymbol, daily, dailyBySymbol, variant }),
    ]),
  );

  return {
    generatedAt: new Date().toISOString(),
    researchOnly: true,
    placesOrders: false,
    strategy: 'C62_FROZEN_ENTRY_EXIT',
    window: id,
    start: start.toISOString(),
    end: end.toISOString(),
    execution: 'Closed 15m C62 signal; next contiguous 15m open; 1% modeled round-trip cost; staged-entry return normalized to deployed capital; stop priority; adverse gaps at open; 24h max hold.',
    v31SourceRules: {
      trendCashHard: 'block if BTC prior completed daily close < SMA200 AND 126-day momentum < 0',
      fastBrakeHard: 'block if (close < SMA200 AND 63-day momentum < 0) OR 63-day momentum < -6% OR (20-day annualized realized vol > 30% AND 63-day momentum < 0)',
      twoStageHard: 'block only if trend is broken AND shock is true',
      realizedVol: '20 prior completed daily log returns, sample stdev * sqrt(252) * 100',
      breadthPorted: false,
    },
    dataCounts: Object.fromEntries(
      Object.entries(barsBySymbol).map(([symbol, rows]) => [symbol, rows.length]),
    ),
    dailyBtcBars: daily.length,
    v4DailyUniverseCount: Object.values(dailyBySymbol).filter((rows) => rows.length).length,
    v4ContextRules: {
      btcUp: 'prior completed BTC daily close > SMA150 and 30d momentum > +5%',
      liquidity: 'top 15 by trailing 30-day median daily dollar volume',
      assetEligibility: '63-day momentum > 0 and close > SMA150',
      minimumEligibleBreadth: 4,
      variants: {
        v4_ready_only: 'allow frozen C62 only when V4 broad rotation readiness is true',
        v4_cash_only: 'allow frozen C62 only when V4 broad rotation readiness is false',
      },
    },
    variants,
  };
}

router.get('/backtest', async (req, res) => {
  try {
    const result = await runC62RegimeWindow(req.query.window || 'recent');
    res.set('Cache-Control', 'no-store');
    return res.json(result);
  } catch (error) {
    console.error('[c62-regime-research]', error);
    return res.status(500).json({ error: error.message });
  }
});


router.get('/adaptive-exit-backtest', async (req, res) => {
  try {
    const slices = {
      earlier: ['2025-11-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'],
      bad: ['2026-03-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'],
      winning: ['2026-07-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z'],
    };
    const id = String(req.query.slice || 'winning').toLowerCase();
    if (!slices[id]) throw new Error('slice must be earlier, bad, or winning');
    const [startIso, endIso] = slices[id];
    const start = new Date(startIso);
    const end = new Date(endIso);
    const { barsBySymbol } = await fetchWindow(start, end);
    const thresholds = [0, 0.5, 1].map((minEdgePct) =>
      runAdaptiveExitSelector({ start, end, barsBySymbol, review: 4, minEdgePct })
    );
    res.set('Cache-Control', 'no-store');
    return res.json({ generatedAt: new Date().toISOString(), researchOnly: true, placesOrders: false, slice: id, start: startIso, end: endIso, thresholds });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
