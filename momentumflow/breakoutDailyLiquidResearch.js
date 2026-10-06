import express from 'express';
import fetch from 'node-fetch';
import { getCredentials } from './alpacaClient.js';

const router = express.Router();
const SYMBOLS = [
  'SPY','QQQ','IWM','DIA','AAPL','MSFT','NVDA','AMZN','META','TSLA',
  'AMD','GOOGL','NFLX','AVGO','INTC','MU','ORCL','CRM','ADBE','PLTR',
  'JPM','BAC','WFC','GS','V','MA','XOM','CVX','COP','SLB',
  'WMT','COST','HD','LOW','DIS','NKE','UBER','ABNB','BA','CAT',
  'GE','F','GM','PFE','LLY','UNH','JNJ','KO','PEP','T',
];
const DATA_BASE = 'https://data.alpaca.markets';
const ENTRY = 55;
const EXIT = 20;
const ROUND_TRIP_COST_PCT = 0.04;

function headers() {
  const c = getCredentials('paper');
  if (!c) throw new Error('No Alpaca paper credentials configured.');
  return { 'APCA-API-KEY-ID': c.keyId, 'APCA-API-SECRET-KEY': c.secretKey };
}

async function bars(symbol, start, end) {
  const qs = new URLSearchParams({
    timeframe: '1Day', start: start.toISOString(), end: end.toISOString(),
    feed: 'iex', adjustment: 'all', sort: 'asc', limit: '10000',
  });
  const r = await fetch(`${DATA_BASE}/v2/stocks/${encodeURIComponent(symbol)}/bars?${qs}`, { headers: headers() });
  const p = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(p?.message || `Bars failed ${symbol} (${r.status})`);
  return Array.isArray(p?.bars) ? p.bars : [];
}

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const jobs = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await worker(items[i]);
    }
  });
  await Promise.all(jobs);
  return out;
}

function test(rows = []) {
  const x = rows.filter((b) => Number(b?.o) > 0 && Number(b?.h) > 0 && Number(b?.l) > 0 && Number(b?.c) > 0);
  if (x.length < ENTRY + 5) return [];
  const o = x.map((b) => Number(b.o));
  const h = x.map((b) => Number(b.h));
  const l = x.map((b) => Number(b.l));
  const c = x.map((b) => Number(b.c));
  const side = ROUND_TRIP_COST_PCT / 200;
  const trades = [];
  let pos = null;
  const close = (raw, i, reason) => {
    const exit = raw * (1 - side);
    trades.push({
      entryTime: x[pos.i]?.t || null,
      exitTime: x[i]?.t || null,
      netReturn: exit / pos.entry - 1,
      holdBars: Math.max(1, i - pos.i + 1),
      reason,
    });
    pos = null;
  };
  for (let i = ENTRY; i < x.length - 1; i += 1) {
    if (pos) {
      const low20 = Math.min(...l.slice(i - EXIT, i));
      if (c[i] < low20) close(o[i + 1], i + 1, '20_DAY_LOW_BREAK');
      continue;
    }
    const high55 = Math.max(...h.slice(i - ENTRY, i));
    if (c[i] > high55) pos = { entry: o[i + 1] * (1 + side), i: i + 1 };
  }
  if (pos) close(c[x.length - 1], x.length - 1, 'END_MARK');
  return trades;
}

function summarize(trades = []) {
  let eq = 1, peak = 1, dd = 0, gw = 0, gl = 0, wins = 0, holds = 0;
  for (const t of trades) {
    const r = Number(t.netReturn || 0);
    eq *= 1 + r;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak > 0 ? 1 - eq / peak : 0);
    if (r > 0) { wins += 1; gw += r; } else if (r < 0) gl += Math.abs(r);
    holds += Number(t.holdBars || 0);
  }
  return {
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    winRatePct: trades.length ? Number((wins / trades.length * 100).toFixed(2)) : 0,
    returnPct: Number(((eq - 1) * 100).toFixed(3)),
    profitFactor: gl > 0 ? Number((gw / gl).toFixed(3)) : (gw > 0 ? 999 : 0),
    maxDrawdownPct: Number((dd * 100).toFixed(3)),
    avgTradePct: trades.length ? Number((trades.reduce((s, t) => s + Number(t.netReturn || 0), 0) / trades.length * 100).toFixed(4)) : 0,
    avgHoldBars: trades.length ? Number((holds / trades.length).toFixed(2)) : 0,
  };
}

function median(a = []) {
  if (!a.length) return 0;
  const x = [...a].sort((m, n) => m - n);
  const i = Math.floor(x.length / 2);
  return Number((x.length % 2 ? x[i] : (x[i - 1] + x[i]) / 2).toFixed(3));
}

function aggregate(per, cutoff) {
  const rows = Object.entries(per);
  const all = rows.flatMap(([, v]) => v.trades);
  const recent = all.filter((t) => new Date(t.entryTime || 0).getTime() >= cutoff);
  const total = summarize(all);
  const recentTotal = summarize(recent);
  const returns = rows.map(([, v]) => v.summary.returnPct);
  const recentReturns = rows.map(([, v]) => v.recent.returnPct);
  const pos = rows.filter(([, v]) => v.summary.returnPct > 0).map(([s]) => s);
  const rpos = rows.filter(([, v]) => v.recent.returnPct > 0).map(([s]) => s);
  const mean = (a) => a.length ? Number((a.reduce((s, n) => s + n, 0) / a.length).toFixed(3)) : 0;
  return {
    all: { ...total, equalWeightSymbolReturnPct: mean(returns), medianSymbolReturnPct: median(returns), positiveSymbols: pos.length, totalSymbols: rows.length, worstSymbolReturnPct: Number(Math.min(...returns).toFixed(3)), bestSymbolReturnPct: Number(Math.max(...returns).toFixed(3)) },
    recent365d: { ...recentTotal, equalWeightSymbolReturnPct: mean(recentReturns), medianSymbolReturnPct: median(recentReturns), positiveSymbols: rpos.length, totalSymbols: rows.length, worstSymbolReturnPct: Number(Math.min(...recentReturns).toFixed(3)), bestSymbolReturnPct: Number(Math.max(...recentReturns).toFixed(3)) },
  };
}

router.get('/daily', async (req, res) => {
  try {
    const days = Math.max(900, Math.min(1825, Math.floor(Number(req.query.days || 1825))));
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    const cutoff = end.getTime() - 365 * 86400000;
    const fetched = await mapLimit(SYMBOLS, 5, async (s) => [s, await bars(s, start, end)]);
    const per = {};
    for (const [symbol, b] of fetched) {
      const trades = test(b);
      const recentTrades = trades.filter((t) => new Date(t.entryTime || 0).getTime() >= cutoff);
      per[symbol] = { bars: b.length, trades, summary: summarize(trades), recent: summarize(recentTrades) };
    }
    const stats = aggregate(per, cutoff);
    res.set('Cache-Control', 'no-store');
    return res.json({
      generatedAt: new Date().toISOString(), researchOnly: true, liveBotChanged: false,
      timeframe: '1Day', universe: 'liquid50', days, adjustment: 'all',
      modeledRoundTripCostPct: ROUND_TRIP_COST_PCT,
      frozenRules: { entry: 'close above prior 55-day high; enter next open', exit: 'close below prior 20-day low; exit next open', parameterChanges: false },
      tradesPerYearWholeWindow: Number((stats.all.trades / (days / 365)).toFixed(1)),
      tradesLast365d: stats.recent365d.trades,
      aggregate: stats.all,
      recent365d: stats.recent365d,
      bySymbol: Object.fromEntries(Object.entries(per).map(([s, v]) => [s, { bars: v.bars, ...v.summary, recent365d: v.recent }])),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
