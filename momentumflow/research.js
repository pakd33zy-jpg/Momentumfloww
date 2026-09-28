import express from 'express';

import { getCryptoBars, getStockBars } from './alpacaClient.js';

const router = express.Router();

const ALLOWED_SYMBOLS = new Set([
  'BTC/USD',
  'ETH/USD',
  'SOL/USD',
  'XRP/USD',
  'LINK/USD',
  'AVAX/USD',
  'LTC/USD',
  'BCH/USD',
  'DOGE/USD',
]);

const TIMEFRAMES = new Map([
  ['15Min', { maxDays: 365, maxPages: 5 }],
  ['1Hour', { maxDays: 730, maxPages: 5 }],
  ['1Day', { maxDays: 1825, maxPages: 2 }],
]);

const ALLOWED_STOCK_SYMBOLS = new Set([
  'SPY', 'QQQ', 'IWM', 'DIA',
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'TSLA',
  'AMD', 'AVGO', 'PLTR', 'COIN', 'MSTR', 'SOFI', 'INTC', 'MU',
  'SMCI', 'RIVN', 'NIO', 'LCID', 'MARA', 'RIOT', 'HOOD',
  'UBER', 'CRM', 'ORCL', 'NFLX', 'F', 'SNAP', 'PFE', 'T',
  'BAC', 'CCL', 'AAL', 'WBD',
]);

function authorized(req) {
  const expected = String(process.env.RESEARCH_EXPORT_TOKEN || '');
  const supplied = String(req.get('x-research-token') || '');
  return expected.length >= 32 && supplied === expected;
}

router.get('/crypto-bars', async (req, res) => {
  if (!authorized(req)) {
    return res.status(404).json({ error: 'Not found.' });
  }

  try {
    const symbol = String(req.query.symbol || '').trim().toUpperCase();
    const timeframe = String(req.query.timeframe || '15Min');
    const timeframeConfig = TIMEFRAMES.get(timeframe);
    const requestedDays = Number(req.query.days || 180);

    if (!ALLOWED_SYMBOLS.has(symbol)) {
      return res.status(400).json({ error: 'Unsupported research symbol.' });
    }
    if (!timeframeConfig) {
      return res.status(400).json({ error: 'Unsupported research timeframe.' });
    }

    const days = Math.max(
      2,
      Math.min(timeframeConfig.maxDays, Math.floor(requestedDays || 180)),
    );
    const requestedEnd = new Date(String(req.query.end || ''));
    const end = Number.isFinite(requestedEnd.getTime())
      ? new Date(Math.min(Date.now(), requestedEnd.getTime()))
      : new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const result = await getCryptoBars('paper', [symbol], {
      timeframe,
      start,
      end,
      limit: 10000,
      sort: 'asc',
      maxPages: timeframeConfig.maxPages,
    });
    const rows = result[symbol] || result[symbol.replace('/', '')] || [];

    res.set('Cache-Control', 'no-store');
    return res.json({
      symbol,
      timeframe,
      start: start.toISOString(),
      end: end.toISOString(),
      bars: rows,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/stock-bars', async (req, res) => {
  if (!authorized(req)) {
    return res.status(404).json({ error: 'Not found.' });
  }

  try {
    const symbol = String(req.query.symbol || '').trim().toUpperCase();
    const timeframe = String(req.query.timeframe || '15Min');
    const timeframeConfig = TIMEFRAMES.get(timeframe);
    const requestedDays = Number(req.query.days || 120);

    if (!ALLOWED_STOCK_SYMBOLS.has(symbol)) {
      return res.status(400).json({ error: 'Unsupported research symbol.' });
    }
    if (!timeframeConfig) {
      return res.status(400).json({ error: 'Unsupported research timeframe.' });
    }

    const days = Math.max(
      2,
      Math.min(timeframeConfig.maxDays, Math.floor(requestedDays || 120)),
    );
    const requestedEnd = new Date(String(req.query.end || ''));
    const end = Number.isFinite(requestedEnd.getTime())
      ? new Date(Math.min(Date.now(), requestedEnd.getTime()))
      : new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const result = await getStockBars('paper', [symbol], {
      timeframe,
      start,
      end,
      limit: 10000,
      feed: 'iex',
      sort: 'asc',
      maxPages: timeframeConfig.maxPages,
    });
    const rows = result[symbol] || [];

    res.set('Cache-Control', 'no-store');
    return res.json({
      symbol,
      timeframe,
      feed: 'iex',
      start: start.toISOString(),
      end: end.toISOString(),
      bars: rows,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});


const MONDAY_EQUITY_SYMBOLS = ['SPY','QQQ','AAPL','MSFT','NVDA','AMZN','META','TSLA','AMD'];

function btEma(values = [], period = 9) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = [Number(values[0])];
  for (let i = 1; i < values.length; i += 1) {
    out.push(Number(values[i]) * k + out[i - 1] * (1 - k));
  }
  return out;
}

function btQuantile(values = [], q = 0.5) {
  const rows = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!rows.length) return 0;
  const p = (rows.length - 1) * Math.max(0, Math.min(1, Number(q) || 0));
  const lo = Math.floor(p);
  const hi = Math.ceil(p);
  return lo === hi ? rows[lo] : rows[lo] + (rows[hi] - rows[lo]) * (p - lo);
}

function btSeries(bars = []) {
  const closes = bars.map((b) => Number(b?.c ?? b?.close ?? 0));
  const opens = bars.map((b) => Number(b?.o ?? b?.open ?? 0));
  const highs = bars.map((b) => Number(b?.h ?? b?.high ?? 0));
  const lows = bars.map((b) => Number(b?.l ?? b?.low ?? 0));
  const fast = btEma(closes, 12);
  const slow = btEma(closes, 26);
  const macd = closes.map((_, i) => fast[i] - slow[i]);
  const signal = btEma(macd, 9);
  const ema20 = btEma(closes, 20);
  const ema200 = btEma(closes, 200);
  const tr = closes.map((c, i) => {
    if (i === 0) return Math.max(0, highs[i] - lows[i]);
    const prev = closes[i - 1];
    return Math.max(highs[i] - lows[i], Math.abs(highs[i] - prev), Math.abs(lows[i] - prev));
  });
  const atr14 = [];
  for (let i = 0; i < tr.length; i += 1) {
    const start = Math.max(0, i - 13);
    const rows = tr.slice(start, i + 1).filter(Number.isFinite);
    atr14.push(rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : 0);
  }
  return { closes, opens, highs, lows, macd, signal, ema20, ema200, atr14 };
}

function btSummary(trades = []) {
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let wins = 0;
  for (const t of trades) {
    const r = Number(t.netReturn || 0);
    equity *= (1 + r);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? 1 - equity / peak : 0);
    if (r > 0) { wins += 1; grossWin += r; }
    else if (r < 0) grossLoss += Math.abs(r);
  }
  return {
    trades: trades.length,
    returnPct: Number(((equity - 1) * 100).toFixed(3)),
    winRatePct: trades.length ? Number((wins / trades.length * 100).toFixed(2)) : 0,
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(3)) : (grossWin > 0 ? 999 : 0),
    maxDrawdownPct: Number((maxDrawdown * 100).toFixed(3)),
    avgTradePct: trades.length ? Number((trades.reduce((s, t) => s + Number(t.netReturn || 0), 0) / trades.length * 100).toFixed(4)) : 0,
  };
}

function btDateKey(bar) {
  const t = new Date(bar?.t || bar?.timestamp || 0);
  if (!Number.isFinite(t.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(t);
}

function backtestValleyCross(bars = [], { q = 0.5, lookback = 200, flatAtClose = false, roundTripCostPct = 0.04 } = {}) {
  const rows = bars.filter((b) => Number(b?.c ?? b?.close ?? 0) > 0 && Number(b?.o ?? b?.open ?? 0) > 0);
  if (rows.length < lookback + 10) return [];
  const s = btSeries(rows);
  const trades = [];
  let pos = null;
  const sideCost = roundTripCostPct / 200;

  for (let i = lookback + 3; i < rows.length - 1; i += 1) {
    if (pos && flatAtClose && btDateKey(rows[i]) !== btDateKey(rows[i + 1])) {
      const exitPrice = s.closes[i];
      const gross = exitPrice / pos.entry - 1;
      trades.push({ netReturn: gross - sideCost * 2, reason: 'EOD' });
      pos = null;
      continue;
    }

    if (!pos) {
      const ti = i - 2;
      const trough = s.macd[ti];
      const valley = trough < 0 && s.macd[ti - 1] > trough;
      const twoRising = s.macd[ti + 1] > trough && s.macd[ti + 2] > s.macd[ti + 1];
      const hist = s.macd.slice(ti - lookback, ti).map((x) => Math.abs(Number(x)));
      const deep = Math.abs(trough) >= btQuantile(hist, q);
      if (valley && twoRising && deep) {
        pos = { entry: s.opens[i + 1] * (1 + sideCost / 100), entryIndex: i + 1 };
      }
      continue;
    }

    const bearishCrossAboveZero =
      s.macd[i - 1] >= s.signal[i - 1] &&
      s.macd[i] < s.signal[i] &&
      s.macd[i] > 0;

    if (bearishCrossAboveZero) {
      const exitPrice = s.opens[i + 1] * (1 - sideCost / 100);
      trades.push({ netReturn: exitPrice / pos.entry - 1, reason: 'MACD_CROSS' });
      pos = null;
    }
  }
  return trades;
}

function backtestTrendCross(bars = [], { atrStop = 1.0, rewardRisk = 2.0, roundTripCostPct = 0.04 } = {}) {
  const rows = bars.filter((b) => Number(b?.c ?? b?.close ?? 0) > 0 && Number(b?.o ?? b?.open ?? 0) > 0);
  if (rows.length < 220) return [];
  const s = btSeries(rows);
  const trades = [];
  let pos = null;
  const sideCost = roundTripCostPct / 200;

  for (let i = 201; i < rows.length - 1; i += 1) {
    if (pos) {
      const hi = s.highs[i];
      const lo = s.lows[i];
      let exitPrice = null;
      let reason = null;
      if (pos.side === 'LONG') {
        if (lo <= pos.stop) { exitPrice = pos.stop; reason = 'STOP'; }
        else if (hi >= pos.target) { exitPrice = pos.target; reason = 'TARGET'; }
      } else {
        if (hi >= pos.stop) { exitPrice = pos.stop; reason = 'STOP'; }
        else if (lo <= pos.target) { exitPrice = pos.target; reason = 'TARGET'; }
      }
      if (exitPrice != null) {
        const gross = pos.side === 'LONG' ? exitPrice / pos.entry - 1 : pos.entry / exitPrice - 1;
        trades.push({ netReturn: gross - sideCost * 2, reason });
        pos = null;
      }
      continue;
    }

    const bullCross = s.macd[i - 1] <= s.signal[i - 1] && s.macd[i] > s.signal[i];
    const bearCross = s.macd[i - 1] >= s.signal[i - 1] && s.macd[i] < s.signal[i];
    const px = s.closes[i];
    const atr = s.atr14[i];
    if (!(atr > 0)) continue;

    if (bullCross && px > s.ema20[i] && px > s.ema200[i]) {
      const entry = s.opens[i + 1] * (1 + sideCost / 100);
      const stop = entry - atr * atrStop;
      const risk = entry - stop;
      pos = { side: 'LONG', entry, stop, target: entry + risk * rewardRisk };
    } else if (bearCross && px < s.ema20[i] && px < s.ema200[i]) {
      const entry = s.opens[i + 1] * (1 - sideCost / 100);
      const stop = entry + atr * atrStop;
      const risk = stop - entry;
      pos = { side: 'SHORT', entry, stop, target: entry - risk * rewardRisk };
    }
  }
  return trades;
}

function aggregateSymbolSummaries(perSymbol = {}) {
  const all = Object.values(perSymbol).flatMap((x) => x.trades || []);
  const summary = btSummary(all);
  const positives = Object.entries(perSymbol).filter(([, x]) => x.summary.returnPct > 0).map(([s]) => s);
  return { ...summary, positiveSymbols: positives.length, totalSymbols: Object.keys(perSymbol).length, positives };
}

router.get('/equity-monday-backtest', async (req, res) => {
  try {
    const days = Math.max(20, Math.min(90, Math.floor(Number(req.query.days || 60))));
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const timeframes = ['5Min', '15Min'];
    const variants = [
      { id: 'VALLEY_5M_Q50', timeframe: '5Min', kind: 'valley', q: 0.50, flatAtClose: false },
      { id: 'VALLEY_5M_Q60', timeframe: '5Min', kind: 'valley', q: 0.60, flatAtClose: false },
      { id: 'VALLEY_5M_Q50_EOD', timeframe: '5Min', kind: 'valley', q: 0.50, flatAtClose: true },
      { id: 'VALLEY_15M_Q50', timeframe: '15Min', kind: 'valley', q: 0.50, flatAtClose: false },
      { id: 'TREND_MACD_5M_1ATR_2R', timeframe: '5Min', kind: 'trend', atrStop: 1.0, rewardRisk: 2.0 },
      { id: 'TREND_MACD_15M_1ATR_2R', timeframe: '15Min', kind: 'trend', atrStop: 1.0, rewardRisk: 2.0 },
    ];

    const barsByTf = {};
    for (const timeframe of timeframes) {
      barsByTf[timeframe] = await getStockBars('paper', MONDAY_EQUITY_SYMBOLS, {
        timeframe, start, end, limit: 10000, feed: 'iex', sort: 'asc', maxPages: 5,
      });
    }

    const results = [];
    for (const variant of variants) {
      const perSymbol = {};
      for (const symbol of MONDAY_EQUITY_SYMBOLS) {
        const bars = barsByTf[variant.timeframe]?.[symbol] || [];
        const trades = variant.kind === 'valley'
          ? backtestValleyCross(bars, variant)
          : backtestTrendCross(bars, variant);
        perSymbol[symbol] = { bars: bars.length, summary: btSummary(trades), trades };
      }
      results.push({
        id: variant.id,
        timeframe: variant.timeframe,
        aggregate: aggregateSymbolSummaries(perSymbol),
        bySymbol: Object.fromEntries(Object.entries(perSymbol).map(([symbol, row]) => [symbol, { bars: row.bars, ...row.summary }])),
      });
    }

    results.sort((a, b) => {
      const ap = a.aggregate.profitFactor;
      const bp = b.aggregate.profitFactor;
      if (bp !== ap) return bp - ap;
      return b.aggregate.returnPct - a.aggregate.returnPct;
    });

    res.set('Cache-Control', 'no-store');
    return res.json({
      generatedAt: new Date().toISOString(),
      days,
      symbols: MONDAY_EQUITY_SYMBOLS,
      roundTripCostPct: 0.04,
      note: 'Research only. Uses next-bar entries and includes modeled round-trip cost.',
      results,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
