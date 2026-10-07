import express from 'express';
import fetch from 'node-fetch';
import { getCredentials } from './alpacaClient.js';

const router = express.Router();
const LIQUID50 = [
  'SPY','QQQ','IWM','DIA','AAPL','MSFT','NVDA','AMZN','META','TSLA',
  'AMD','GOOGL','NFLX','AVGO','INTC','MU','ORCL','CRM','ADBE','PLTR',
  'JPM','BAC','WFC','GS','V','MA','XOM','CVX','COP','SLB',
  'WMT','COST','HD','LOW','DIS','NKE','UBER','ABNB','BA','CAT',
  'GE','F','GM','PFE','LLY','UNH','JNJ','KO','PEP','T',
];
const LIQUID100 = [
  ...LIQUID50,
  'XLK','XLF','XLE','XLV','XLY','XLP','XLI','XLU','XLB','XLC',
  'QCOM','TXN','AMAT','LRCX','KLAC','MRVL','CSCO','IBM','NOW','SNOW',
  'C','SCHW','MS','AXP','COF','OXY','MPC','PSX','HAL','EOG',
  'MCD','SBUX','TGT','TJX','BKNG','DE','UPS','RTX','LMT','HON',
  'ABBV','MRK','TMO','ABT','MDT','CMCSA','VZ','SHOP','SNAP','ROKU',
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

async function batchBars(symbols, start, end) {
  const output = Object.fromEntries(symbols.map((s) => [s, []]));
  let pageToken = null;
  let pages = 0;
  do {
    const qs = new URLSearchParams({
      symbols: symbols.join(','),
      timeframe: '1Day',
      start: start.toISOString(),
      end: end.toISOString(),
      feed: 'iex',
      adjustment: 'all',
      sort: 'asc',
      limit: '10000',
    });
    if (pageToken) qs.set('page_token', pageToken);
    const r = await fetch(`${DATA_BASE}/v2/stocks/bars?${qs}`, { headers: headers() });
    const p = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(p?.message || `Bars batch failed (${r.status})`);
    for (const [symbol, rows] of Object.entries(p?.bars || {})) {
      if (!output[symbol]) output[symbol] = [];
      output[symbol].push(...(Array.isArray(rows) ? rows : []));
    }
    pageToken = p?.next_page_token || null;
    pages += 1;
    if (pages > 30) throw new Error('Bars pagination exceeded 30 pages');
  } while (pageToken);
  return output;
}


function test(rows = [], regimeOk = null) {
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
    const signalTs = new Date(x[i]?.t || 0).getTime();
    const regimePass = !regimeOk || regimeOk.get(signalTs) === true;
    if (regimePass && c[i] > high55) pos = { entry: o[i + 1] * (1 + side), i: i + 1 };
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

function capacityStudy(per, cutoff) {
  const trades = Object.entries(per).flatMap(([symbol, v]) =>
    (v.trades || []).map((t) => ({ ...t, symbol }))
  ).sort((a, b) => {
    const dt = new Date(a.entryTime || 0).getTime() - new Date(b.entryTime || 0).getTime();
    return dt || String(a.symbol).localeCompare(String(b.symbol));
  });

  function simulate(cap = Infinity) {
    const active = [];
    const accepted = [];
    const skipped = [];
    let maxConcurrentUsed = 0;

    for (const trade of trades) {
      const entryMs = new Date(trade.entryTime || 0).getTime();
      for (let i = active.length - 1; i >= 0; i -= 1) {
        const exitMs = new Date(active[i].exitTime || 0).getTime();
        if (exitMs <= entryMs) active.splice(i, 1);
      }
      if (active.length < cap) {
        accepted.push(trade);
        active.push(trade);
        maxConcurrentUsed = Math.max(maxConcurrentUsed, active.length);
      } else {
        skipped.push(trade);
      }
    }

    const recentAccepted = accepted.filter((t) => new Date(t.entryTime || 0).getTime() >= cutoff);
    const recentSkipped = skipped.filter((t) => new Date(t.entryTime || 0).getTime() >= cutoff);
    const recentSignals = recentAccepted.length + recentSkipped.length;

    return {
      cap: Number.isFinite(cap) ? cap : 'uncapped',
      acceptedTrades: accepted.length,
      skippedSignals: skipped.length,
      captureRatePct: trades.length ? Number((accepted.length / trades.length * 100).toFixed(2)) : 0,
      maxConcurrentUsed,
      acceptedTradeStats: summarize(accepted),
      recent365d: {
        acceptedTrades: recentAccepted.length,
        skippedSignals: recentSkipped.length,
        captureRatePct: recentSignals ? Number((recentAccepted.length / recentSignals * 100).toFixed(2)) : 0,
        acceptedTradeStats: summarize(recentAccepted),
      },
    };
  }

  const uncapped = simulate(Infinity);
  return {
    methodology: 'first-come-first-served by entry timestamp; exits at the same open free capacity before new entries; simultaneous entries tie-break alphabetically; no position sizing or portfolio-return assumptions',
    rawSignals: trades.length,
    unconstrainedMaxConcurrentPositions: uncapped.maxConcurrentUsed,
    variants: [simulate(8), simulate(12), simulate(20), simulate(30), simulate(40), simulate(60), uncapped],
  };
}

router.get('/daily', async (req, res) => {
  try {
    const days = Math.max(900, Math.min(1825, Math.floor(Number(req.query.days || 1825))));
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    const cutoff = end.getTime() - 365 * 86400000;
    const universe = String(req.query.universe || 'liquid100').toLowerCase();
    const symbols = universe === 'liquid50' ? LIQUID50 : LIQUID100;
    const barsBySymbol = await batchBars(symbols, start, end);
    const fetched = symbols.map((s) => [s, barsBySymbol[s] || []]);
    const regime = String(req.query.regime || 'none').toLowerCase();
    let regimeOk = null;
    if (regime === 'spy200') {
      const spyRows = (fetched.find(([s]) => s === 'SPY')?.[1] || [])
        .filter((b) => Number(b?.c) > 0);
      regimeOk = new Map();
      for (let i = 199; i < spyRows.length; i += 1) {
        const sma200 = spyRows.slice(i - 199, i + 1).reduce((sum, b) => sum + Number(b.c), 0) / 200;
        regimeOk.set(new Date(spyRows[i].t).getTime(), Number(spyRows[i].c) > sma200);
      }
    }
    const per = {};
    for (const [symbol, b] of fetched) {
      const trades = test(b, regimeOk);
      const recentTrades = trades.filter((t) => new Date(t.entryTime || 0).getTime() >= cutoff);
      per[symbol] = { bars: b.length, trades, summary: summarize(trades), recent: summarize(recentTrades) };
    }
    const stats = aggregate(per, cutoff);
    const capacity = capacityStudy(per, cutoff);
    res.set('Cache-Control', 'no-store');
    return res.json({
      generatedAt: new Date().toISOString(), researchOnly: true, liveBotChanged: false,
      timeframe: '1Day', universe: universe === 'liquid50' ? 'liquid50' : 'liquid100', regime: regime === 'spy200' ? 'spy200' : 'none', days, adjustment: 'all',
      modeledRoundTripCostPct: ROUND_TRIP_COST_PCT,
      frozenRules: { entry: 'close above prior 55-day high; enter next open', exit: 'close below prior 20-day low; exit next open', parameterChanges: false },
      tradesPerYearWholeWindow: Number((stats.all.trades / (days / 365)).toFixed(1)),
      tradesLast365d: stats.recent365d.trades,
      aggregate: stats.all,
      recent365d: stats.recent365d,
      capacityStudy: capacity,
      bySymbol: Object.fromEntries(Object.entries(per).map(([s, v]) => [s, { bars: v.bars, ...v.summary, recent365d: v.recent }])),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
