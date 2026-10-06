import express from 'express';
import { getStockBars } from './alpacaClient.js';

const router = express.Router();

const CORE_SYMBOLS = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'TSLA', 'AMD'];
const ROUND_TRIP_COST_PCT = 0.04;

function ema(values = [], period = 20) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = [Number(values[0])];
  for (let i = 1; i < values.length; i += 1) {
    out.push(Number(values[i]) * k + out[i - 1] * (1 - k));
  }
  return out;
}

function summarize(trades = []) {
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let wins = 0;
  let holdBars = 0;

  for (const trade of trades) {
    const r = Number(trade.netReturn || 0);
    equity *= 1 + r;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? 1 - equity / peak : 0);
    if (r > 0) {
      wins += 1;
      grossWin += r;
    } else if (r < 0) {
      grossLoss += Math.abs(r);
    }
    holdBars += Number(trade.holdBars || 0);
  }

  return {
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    winRatePct: trades.length ? Number((wins / trades.length * 100).toFixed(2)) : 0,
    returnPct: Number(((equity - 1) * 100).toFixed(3)),
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(3)) : (grossWin > 0 ? 999 : 0),
    maxDrawdownPct: Number((maxDrawdown * 100).toFixed(3)),
    avgTradePct: trades.length
      ? Number((trades.reduce((sum, t) => sum + Number(t.netReturn || 0), 0) / trades.length * 100).toFixed(4))
      : 0,
    avgHoldBars: trades.length ? Number((holdBars / trades.length).toFixed(2)) : 0,
  };
}

function backtestTrendPullback(bars = []) {
  const rows = bars.filter((bar) =>
    Number(bar?.o ?? bar?.open ?? 0) > 0 &&
    Number(bar?.h ?? bar?.high ?? 0) > 0 &&
    Number(bar?.l ?? bar?.low ?? 0) > 0 &&
    Number(bar?.c ?? bar?.close ?? 0) > 0
  );
  if (rows.length < 220) return [];

  const opens = rows.map((b) => Number(b?.o ?? b?.open));
  const highs = rows.map((b) => Number(b?.h ?? b?.high));
  const lows = rows.map((b) => Number(b?.l ?? b?.low));
  const closes = rows.map((b) => Number(b?.c ?? b?.close));
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const sideCost = ROUND_TRIP_COST_PCT / 200;

  const trades = [];
  let pos = null;

  const closePosition = (rawExit, exitIndex, reason) => {
    const exit = rawExit * (1 - sideCost);
    trades.push({
      entryTime: rows[pos.entryIndex]?.t || rows[pos.entryIndex]?.timestamp || null,
      exitTime: rows[exitIndex]?.t || rows[exitIndex]?.timestamp || null,
      entry: pos.entry,
      exit,
      stop: pos.stop,
      holdBars: Math.max(1, exitIndex - pos.entryIndex + 1),
      reason,
      netReturn: exit / pos.entry - 1,
    });
    pos = null;
  };

  for (let i = 205; i < rows.length - 1; i += 1) {
    if (pos) {
      if (opens[i] <= pos.stop) {
        closePosition(opens[i], i, 'GAP_STOP');
        continue;
      }
      if (lows[i] <= pos.stop) {
        closePosition(pos.stop, i, 'STRUCTURE_STOP');
        continue;
      }
      if (closes[i] < ema50[i]) {
        closePosition(opens[i + 1], i + 1, 'TREND_BREAK');
        continue;
      }
      continue;
    }

    const trendUp =
      closes[i] > ema50[i] &&
      ema50[i] > ema200[i] &&
      ema50[i] > ema50[i - 5];
    if (!trendUp) continue;

    const pullbackStart = i - 5;
    let touchedEma20 = false;
    let heldEma50 = true;
    for (let j = pullbackStart; j < i; j += 1) {
      if (lows[j] <= ema20[j] && closes[j] > ema50[j]) touchedEma20 = true;
      if (!(closes[j] > ema50[j])) heldEma50 = false;
    }

    const reentryConfirmed = closes[i] > highs[i - 1] && closes[i] > ema20[i];
    if (!touchedEma20 || !heldEma50 || !reentryConfirmed) continue;

    const rawStop = Math.min(...lows.slice(pullbackStart, i + 1));
    const entry = opens[i + 1] * (1 + sideCost);
    if (!(rawStop > 0 && rawStop < entry)) continue;

    pos = {
      entry,
      stop: rawStop,
      entryIndex: i + 1,
    };
  }

  if (pos) {
    closePosition(closes[rows.length - 1], rows.length - 1, 'END_MARK');
  }

  return trades;
}

function aggregate(perSymbol = {}, recentCutoffMs = 0) {
  const allTrades = Object.values(perSymbol).flatMap((row) => row.trades || []);
  const recentTrades = allTrades.filter((t) => new Date(t.entryTime || 0).getTime() >= recentCutoffMs);
  const symbolRows = Object.entries(perSymbol);
  const symbolReturns = symbolRows.map(([, row]) => Number(row.summary.returnPct || 0));
  const positiveSymbols = symbolRows.filter(([, row]) => Number(row.summary.returnPct || 0) > 0).map(([symbol]) => symbol);
  const recentPositiveSymbols = symbolRows
    .filter(([, row]) => Number(row.recentSummary.returnPct || 0) > 0)
    .map(([symbol]) => symbol);

  return {
    all: {
      ...summarize(allTrades),
      equalWeightSymbolReturnPct: symbolReturns.length
        ? Number((symbolReturns.reduce((a, b) => a + b, 0) / symbolReturns.length).toFixed(3))
        : 0,
      positiveSymbols: positiveSymbols.length,
      totalSymbols: symbolRows.length,
      positiveSymbolNames: positiveSymbols,
      worstSymbolReturnPct: symbolReturns.length ? Number(Math.min(...symbolReturns).toFixed(3)) : 0,
      bestSymbolReturnPct: symbolReturns.length ? Number(Math.max(...symbolReturns).toFixed(3)) : 0,
    },
    recent365d: {
      ...summarize(recentTrades),
      positiveSymbols: recentPositiveSymbols.length,
      totalSymbols: symbolRows.length,
      positiveSymbolNames: recentPositiveSymbols,
    },
  };
}

router.get('/daily', async (req, res) => {
  try {
    const requested = String(req.query.symbols || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => CORE_SYMBOLS.includes(s));
    const symbols = requested.length ? [...new Set(requested)] : CORE_SYMBOLS;
    const days = Math.max(900, Math.min(1825, Math.floor(Number(req.query.days || 1200))));
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const recentCutoffMs = end.getTime() - 365 * 24 * 60 * 60 * 1000;

    const fetched = await Promise.all(symbols.map(async (symbol) => {
      const data = await getStockBars('paper', [symbol], {
        timeframe: '1Day',
        start,
        end,
        limit: 10000,
        feed: 'iex',
        sort: 'asc',
        maxPages: 2,
      });
      return [symbol, data[symbol] || []];
    }));

    const perSymbol = {};
    for (const [symbol, bars] of fetched) {
      const trades = backtestTrendPullback(bars);
      const recentTrades = trades.filter((t) => new Date(t.entryTime || 0).getTime() >= recentCutoffMs);
      perSymbol[symbol] = {
        bars: bars.length,
        summary: summarize(trades),
        recentSummary: summarize(recentTrades),
        trades,
      };
    }

    const stats = aggregate(perSymbol, recentCutoffMs);
    res.set('Cache-Control', 'no-store');
    return res.json({
      generatedAt: new Date().toISOString(),
      researchOnly: true,
      liveBotChanged: false,
      timeframe: '1Day',
      days,
      symbols,
      modeledRoundTripCostPct: ROUND_TRIP_COST_PCT,
      rules: {
        trend: 'close > EMA50 > EMA200 and EMA50 rising versus 5 bars ago',
        pullback: 'during prior 5 bars price touches EMA20 while all closes remain above EMA50',
        confirmation: 'current close breaks prior bar high and closes above EMA20',
        entry: 'next daily bar open',
        stop: 'lowest low of pullback/current 6-bar structure',
        exit: 'structure stop or next-bar open after daily close below EMA50; no fixed profit target',
      },
      aggregate: stats.all,
      recent365d: stats.recent365d,
      bySymbol: Object.fromEntries(Object.entries(perSymbol).map(([symbol, row]) => [symbol, {
        bars: row.bars,
        ...row.summary,
        recent365d: row.recentSummary,
      }])),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
