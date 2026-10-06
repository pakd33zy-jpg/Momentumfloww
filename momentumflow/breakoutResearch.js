import express from 'express';
import fetch from 'node-fetch';
import { getCredentials } from './alpacaClient.js';

const router = express.Router();
const CORE_SYMBOLS = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'TSLA', 'AMD'];
const DATA_BASE = 'https://data.alpaca.markets';
const ROUND_TRIP_COST_PCT = 0.04;
const ENTRY_LOOKBACK = 55;
const EXIT_LOOKBACK = 20;

function headers() {
  const creds = getCredentials('paper');
  if (!creds) throw new Error('No Alpaca paper credentials configured.');
  return {
    'APCA-API-KEY-ID': creds.keyId,
    'APCA-API-SECRET-KEY': creds.secretKey,
  };
}

async function dailyBars(symbol, start, end) {
  const qs = new URLSearchParams({
    timeframe: '1Day',
    start: start.toISOString(),
    end: end.toISOString(),
    feed: 'iex',
    adjustment: 'all',
    sort: 'asc',
    limit: '10000',
  });
  const response = await fetch(`${DATA_BASE}/v2/stocks/${encodeURIComponent(symbol)}/bars?${qs.toString()}`, {
    headers: headers(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || `Bars request failed for ${symbol} (${response.status})`);
  return Array.isArray(payload?.bars) ? payload.bars : [];
}

function summarize(trades = []) {
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let wins = 0;
  let holdBars = 0;

  for (const t of trades) {
    const r = Number(t.netReturn || 0);
    equity *= 1 + r;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? 1 - equity / peak : 0);
    if (r > 0) { wins += 1; grossWin += r; }
    else if (r < 0) grossLoss += Math.abs(r);
    holdBars += Number(t.holdBars || 0);
  }

  return {
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    winRatePct: trades.length ? Number((wins / trades.length * 100).toFixed(2)) : 0,
    returnPct: Number(((equity - 1) * 100).toFixed(3)),
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(3)) : (grossWin > 0 ? 999 : 0),
    maxDrawdownPct: Number((maxDrawdown * 100).toFixed(3)),
    avgTradePct: trades.length ? Number((trades.reduce((a, t) => a + Number(t.netReturn || 0), 0) / trades.length * 100).toFixed(4)) : 0,
    avgHoldBars: trades.length ? Number((holdBars / trades.length).toFixed(2)) : 0,
  };
}

function pooled(trades = []) {
  const s = summarize(trades);
  return {
    trades: s.trades,
    wins: s.wins,
    losses: s.losses,
    winRatePct: s.winRatePct,
    profitFactor: s.profitFactor,
    avgTradePct: s.avgTradePct,
    avgHoldBars: s.avgHoldBars,
  };
}

function median(values = []) {
  if (!values.length) return 0;
  const a = [...values].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return Number((a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2).toFixed(3));
}

function backtest(bars = []) {
  const rows = bars.filter((b) => Number(b?.o) > 0 && Number(b?.h) > 0 && Number(b?.l) > 0 && Number(b?.c) > 0);
  if (rows.length < ENTRY_LOOKBACK + 5) return [];

  const opens = rows.map((b) => Number(b.o));
  const highs = rows.map((b) => Number(b.h));
  const lows = rows.map((b) => Number(b.l));
  const closes = rows.map((b) => Number(b.c));
  const sideCost = ROUND_TRIP_COST_PCT / 200;
  const trades = [];
  let pos = null;

  const closePos = (rawExit, index, reason) => {
    const exit = rawExit * (1 - sideCost);
    trades.push({
      entryTime: rows[pos.entryIndex]?.t || null,
      exitTime: rows[index]?.t || null,
      entry: pos.entry,
      exit,
      holdBars: Math.max(1, index - pos.entryIndex + 1),
      reason,
      netReturn: exit / pos.entry - 1,
    });
    pos = null;
  };

  for (let i = ENTRY_LOOKBACK; i < rows.length - 1; i += 1) {
    if (pos) {
      const priorExitLow = Math.min(...lows.slice(i - EXIT_LOOKBACK, i));
      if (closes[i] < priorExitLow) {
        closePos(opens[i + 1], i + 1, '20_DAY_LOW_BREAK');
      }
      continue;
    }

    const priorEntryHigh = Math.max(...highs.slice(i - ENTRY_LOOKBACK, i));
    if (closes[i] > priorEntryHigh) {
      pos = {
        entry: opens[i + 1] * (1 + sideCost),
        entryIndex: i + 1,
      };
    }
  }

  if (pos) closePos(closes[rows.length - 1], rows.length - 1, 'END_MARK');
  return trades;
}

function aggregate(perSymbol, recentCutoffMs) {
  const entries = Object.entries(perSymbol);
  const allTrades = entries.flatMap(([, r]) => r.trades);
  const recentTrades = allTrades.filter((t) => new Date(t.entryTime || 0).getTime() >= recentCutoffMs);
  const returns = entries.map(([, r]) => r.summary.returnPct);
  const recentReturns = entries.map(([, r]) => r.recentSummary.returnPct);
  const positives = entries.filter(([, r]) => r.summary.returnPct > 0).map(([s]) => s);
  const recentPositives = entries.filter(([, r]) => r.recentSummary.returnPct > 0).map(([s]) => s);

  const eq = (vals) => vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3)) : 0;

  return {
    all: {
      ...pooled(allTrades),
      equalWeightSymbolReturnPct: eq(returns),
      medianSymbolReturnPct: median(returns),
      positiveSymbols: positives.length,
      totalSymbols: entries.length,
      positiveSymbolNames: positives,
      worstSymbolReturnPct: returns.length ? Number(Math.min(...returns).toFixed(3)) : 0,
      bestSymbolReturnPct: returns.length ? Number(Math.max(...returns).toFixed(3)) : 0,
    },
    recent365d: {
      ...pooled(recentTrades),
      equalWeightSymbolReturnPct: eq(recentReturns),
      medianSymbolReturnPct: median(recentReturns),
      positiveSymbols: recentPositives.length,
      totalSymbols: entries.length,
      positiveSymbolNames: recentPositives,
      worstSymbolReturnPct: recentReturns.length ? Number(Math.min(...recentReturns).toFixed(3)) : 0,
      bestSymbolReturnPct: recentReturns.length ? Number(Math.max(...recentReturns).toFixed(3)) : 0,
    },
  };
}

router.get('/daily', async (req, res) => {
  try {
    const requested = String(req.query.symbols || '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => CORE_SYMBOLS.includes(s));
    const symbols = requested.length ? [...new Set(requested)] : CORE_SYMBOLS;
    const days = Math.max(900, Math.min(1825, Math.floor(Number(req.query.days || 1200))));
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    const recentCutoffMs = end.getTime() - 365 * 86400000;

    const fetched = await Promise.all(symbols.map(async (symbol) => [symbol, await dailyBars(symbol, start, end)]));
    const perSymbol = {};
    for (const [symbol, bars] of fetched) {
      const trades = backtest(bars);
      const recentTrades = trades.filter((t) => new Date(t.entryTime || 0).getTime() >= recentCutoffMs);
      perSymbol[symbol] = {
        bars: bars.length,
        trades,
        summary: summarize(trades),
        recentSummary: summarize(recentTrades),
      };
    }

    const stats = aggregate(perSymbol, recentCutoffMs);
    res.set('Cache-Control', 'no-store');
    return res.json({
      generatedAt: new Date().toISOString(),
      researchOnly: true,
      liveBotChanged: false,
      timeframe: '1Day',
      adjustment: 'all',
      days,
      symbols,
      modeledRoundTripCostPct: ROUND_TRIP_COST_PCT,
      rules: {
        entry: 'daily close above the highest high of the prior 55 trading days; enter next open',
        exit: 'daily close below the lowest low of the prior 20 trading days; exit next open',
        direction: 'long only',
        fixedTarget: false,
        indicatorStack: false,
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
