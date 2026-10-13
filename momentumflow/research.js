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

function backtestValleyCross(bars = [], { q = 0.5, lookback = 200, flatAtClose = false, emergencyStopPct = 0, maxHoldBars = 0, roundTripCostPct = 0.04 } = {}) {
  const rows = bars.filter((b) => Number(b?.c ?? b?.close ?? 0) > 0 && Number(b?.o ?? b?.open ?? 0) > 0);
  if (rows.length < lookback + 10) return [];
  const s = btSeries(rows);
  const trades = [];
  let pos = null;
  const sideCost = roundTripCostPct / 200;

  for (let i = lookback + 3; i < rows.length - 1; i += 1) {
    if (pos && emergencyStopPct > 0) {
      const stop = pos.entry * (1 - emergencyStopPct / 100);
      const open = s.opens[i];
      const low = s.lows[i];
      if (open <= stop || low <= stop) {
        const rawExit = open <= stop ? open : stop;
        const exitPrice = rawExit * (1 - sideCost);
        trades.push({ netReturn: exitPrice / pos.entry - 1, reason: 'EMERGENCY_STOP' });
        pos = null;
        continue;
      }
    }

    if (pos && maxHoldBars > 0 && i - pos.entryIndex >= maxHoldBars) {
      const exitPrice = s.opens[i] * (1 - sideCost);
      trades.push({ netReturn: exitPrice / pos.entry - 1, reason: 'MAX_HOLD' });
      pos = null;
      continue;
    }

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
        pos = { entry: s.opens[i + 1] * (1 + sideCost), entryIndex: i + 1 };
      }
      continue;
    }

    const bearishCrossAboveZero =
      s.macd[i - 1] >= s.signal[i - 1] &&
      s.macd[i] < s.signal[i] &&
      s.macd[i] > 0;

    if (bearishCrossAboveZero) {
      const exitPrice = s.opens[i + 1] * (1 - sideCost);
      trades.push({ netReturn: exitPrice / pos.entry - 1, reason: 'MACD_CROSS' });
      pos = null;
    }
  }
  return trades;
}


function rsiSeries(values = [], period = 2) {
  const out = new Array(values.length).fill(NaN);
  if (values.length <= period) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const d = values[i] - values[i - 1];
    gains += Math.max(d, 0);
    losses += Math.max(-d, 0);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i += 1) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function backtestCryptoDailyPullback(bars = [], { entryRsi = 10, exitRsi = 70, maxHoldBars = 5, roundTripCostPct = 0.50, startMs = 0 } = {}) {
  const rows = bars.filter((b) => Number(b?.c ?? b?.close ?? 0) > 0 && Number(b?.o ?? b?.open ?? 0) > 0);
  if (rows.length < 210) return [];
  const closes = rows.map((b) => Number(b?.c ?? b?.close));
  const opens = rows.map((b) => Number(b?.o ?? b?.open));
  const rsi2 = rsiSeries(closes, 2);
  const sideCost = roundTripCostPct / 200;
  const trades = [];
  let pos = null;
  for (let i = 200; i < rows.length - 1; i += 1) {
    if (pos) {
      const held = i - pos.entryIndex;
      if (rsi2[i] >= exitRsi || held >= maxHoldBars) {
        const exit = opens[i + 1] * (1 - sideCost);
        trades.push({ netReturn: exit / pos.entry - 1, reason: rsi2[i] >= exitRsi ? 'RSI_REBOUND' : 'MAX_HOLD' });
        pos = null;
      }
      continue;
    }
    const signalTime = new Date(rows[i]?.t ?? rows[i]?.timestamp ?? 0).getTime();
    if (signalTime < startMs) continue;
    const sma200 = closes.slice(i - 199, i + 1).reduce((sum, value) => sum + value, 0) / 200;
    if (closes[i] > sma200 && rsi2[i] <= entryRsi) {
      pos = { entry: opens[i + 1] * (1 + sideCost), entryIndex: i + 1 };
    }
  }
  if (pos) trades.push({ netReturn: closes.at(-1) * (1 - sideCost) / pos.entry - 1, reason: 'END_MARK' });
  return trades;
}




async function fetchCryptoHourlyComplete(symbol, start, end) {
  const rows = [];
  let cursor = new Date(start);
  const chunkMs = 180 * 86400000;
  while (cursor < end) {
    const chunkEnd = new Date(Math.min(end.getTime(), cursor.getTime() + chunkMs));
    const result = await getCryptoBars('paper', [symbol], {
      timeframe: '1Hour', start: cursor, end: chunkEnd, limit: 10000, sort: 'asc', maxPages: 2,
    });
    rows.push(...(result[symbol] || result[symbol.replace('/', '')] || []));
    cursor = chunkEnd;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const deduped = new Map(rows.map((bar) => [new Date(bar?.t ?? bar?.timestamp ?? 0).getTime(), bar]));
  return [...deduped.values()].sort((a, b) =>
    new Date(a?.t ?? a?.timestamp ?? 0).getTime() - new Date(b?.t ?? b?.timestamp ?? 0).getTime()
  );
}

function aggregateCryptoFourHour(hourly = []) {
  const buckets = new Map();
  for (const bar of hourly) {
    const time = new Date(bar?.t ?? bar?.timestamp ?? 0).getTime();
    if (!Number.isFinite(time)) continue;
    const bucket = Math.floor(time / 14400000) * 14400000;
    const o = Number(bar?.o ?? bar?.open ?? 0);
    const h = Number(bar?.h ?? bar?.high ?? 0);
    const l = Number(bar?.l ?? bar?.low ?? 0);
    const c = Number(bar?.c ?? bar?.close ?? 0);
    if (!(o > 0 && h > 0 && l > 0 && c > 0)) continue;
    const row = buckets.get(bucket);
    if (!row) buckets.set(bucket, { t: new Date(bucket).toISOString(), o, h, l, c });
    else {
      row.h = Math.max(row.h, h);
      row.l = Math.min(row.l, l);
      row.c = c;
    }
  }
  return [...buckets.values()].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}

function btcDailyTrendAt(daily = [], signalTime = 0, strong = false) {
  let end = -1;
  for (let i = 0; i < daily.length; i += 1) {
    const barTime = new Date(daily[i]?.t ?? daily[i]?.timestamp ?? 0).getTime();
    if (barTime + 86400000 <= signalTime) end = i;
    else break;
  }
  if (end < 150) return false;
  const closes = daily.map((b) => Number(b?.c ?? b?.close ?? 0));
  const close = closes[end];
  const sma150 = closes.slice(end - 149, end + 1).reduce((a, b) => a + b, 0) / 150;
  const mom30 = close / closes[end - 30] - 1;
  return close > sma150 && mom30 > (strong ? 0.05 : 0);
}

function backtestCryptoBreakoutWithRegime(bars = [], btcDaily = [], {
  entryBars = 20, exitBars = 10, roundTripCostPct = 0.50, startMs = 0, regime = 'mild',
} = {}) {
  const rows = bars.filter((b) => Number(b?.c ?? b?.close ?? 0) > 0 && Number(b?.o ?? b?.open ?? 0) > 0);
  if (rows.length < entryBars + 5) return [];
  const sideCost = roundTripCostPct / 200;
  const high = (b) => Number(b?.h ?? b?.high ?? 0);
  const low = (b) => Number(b?.l ?? b?.low ?? 0);
  const trades = [];
  let pos = null;
  for (let i = entryBars; i < rows.length - 1; i += 1) {
    const close = Number(rows[i]?.c ?? rows[i]?.close ?? 0);
    const nextOpen = Number(rows[i + 1]?.o ?? rows[i + 1]?.open ?? 0);
    if (pos) {
      const priorLow = Math.min(...rows.slice(i - exitBars, i).map(low));
      if (close < priorLow && nextOpen > 0) {
        const exit = nextOpen * (1 - sideCost);
        trades.push({ netReturn: exit / pos.entry - 1, reason: 'CHANNEL_EXIT' });
        pos = null;
      }
      continue;
    }
    const signalTime = new Date(rows[i]?.t ?? rows[i]?.timestamp ?? 0).getTime();
    if (signalTime < startMs) continue;
    const priorHigh = Math.max(...rows.slice(i - entryBars, i).map(high));
    const allowed = regime === 'none' || btcDailyTrendAt(btcDaily, signalTime, regime === 'strong');
    if (allowed && close > priorHigh && nextOpen > 0) pos = { entry: nextOpen * (1 + sideCost) };
  }
  if (pos) {
    const finalClose = Number(rows.at(-1)?.c ?? rows.at(-1)?.close ?? 0);
    if (finalClose > 0) trades.push({ netReturn: finalClose * (1 - sideCost) / pos.entry - 1, reason: 'END_MARK' });
  }
  return trades;
}

function backtestCryptoBreakout(bars = [], { entryBars = 55, exitBars = 20, roundTripCostPct = 0.50 } = {}) {
  const rows = bars.filter((b) => Number(b?.c ?? b?.close ?? 0) > 0 && Number(b?.o ?? b?.open ?? 0) > 0);
  if (rows.length < entryBars + 5) return [];
  const sideCost = roundTripCostPct / 200;
  const trades = [];
  let pos = null;
  for (let i = entryBars; i < rows.length - 1; i += 1) {
    const high = (b) => Number(b?.h ?? b?.high ?? 0);
    const low = (b) => Number(b?.l ?? b?.low ?? 0);
    const close = Number(rows[i]?.c ?? rows[i]?.close ?? 0);
    const nextOpen = Number(rows[i + 1]?.o ?? rows[i + 1]?.open ?? 0);
    if (pos) {
      const priorLow = Math.min(...rows.slice(i - exitBars, i).map(low));
      if (close < priorLow && nextOpen > 0) {
        const exit = nextOpen * (1 - sideCost);
        trades.push({ netReturn: exit / pos.entry - 1, reason: 'CHANNEL_EXIT' });
        pos = null;
      }
      continue;
    }
    const priorHigh = Math.max(...rows.slice(i - entryBars, i).map(high));
    if (close > priorHigh && nextOpen > 0) pos = { entry: nextOpen * (1 + sideCost) };
  }
  if (pos) {
    const finalClose = Number(rows.at(-1)?.c ?? rows.at(-1)?.close ?? 0);
    if (finalClose > 0) trades.push({ netReturn: finalClose * (1 - sideCost) / pos.entry - 1, reason: 'END_MARK' });
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
      const entry = s.opens[i + 1] * (1 + sideCost);
      const stop = entry - atr * atrStop;
      const risk = entry - stop;
      pos = { side: 'LONG', entry, stop, target: entry + risk * rewardRisk };
    } else if (bearCross && px < s.ema20[i] && px < s.ema200[i]) {
      const entry = s.opens[i + 1] * (1 - sideCost);
      const stop = entry + atr * atrStop;
      const risk = stop - entry;
      pos = { side: 'SHORT', entry, stop, target: entry - risk * rewardRisk };
    }
  }
  return trades;
}

function aggregateSymbolSummaries(perSymbol = {}) {
  const all = Object.values(perSymbol).flatMap((x) => x.trades || []);
  const tradeStats = btSummary(all);
  const rows = Object.entries(perSymbol);
  const returns = rows.map(([, x]) => Number(x.summary.returnPct || 0));
  const positives = rows.filter(([, x]) => x.summary.returnPct > 0).map(([s]) => s);
  const sorted = [...returns].sort((a, b) => a - b);
  const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const median = sorted.length
    ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
    : 0;
  return {
    trades: tradeStats.trades,
    winRatePct: tradeStats.winRatePct,
    profitFactor: tradeStats.profitFactor,
    avgTradePct: tradeStats.avgTradePct,
    equalWeightSleevesReturnPct: Number(mean.toFixed(3)),
    medianSymbolReturnPct: Number(median.toFixed(3)),
    positiveSymbols: positives.length,
    totalSymbols: rows.length,
    positives,
    worstSymbolReturnPct: returns.length ? Number(Math.min(...returns).toFixed(3)) : 0,
    bestSymbolReturnPct: returns.length ? Number(Math.max(...returns).toFixed(3)) : 0,
  };
}

router.get('/equity-monday-backtest', async (req, res) => {
  try {
    const days = Math.max(20, Math.min(90, Math.floor(Number(req.query.days || 60))));
    const requestedSymbols = String(req.query.symbols || '')
      .split(',')
      .map((x) => x.trim().toUpperCase())
      .filter((x) => MONDAY_EQUITY_SYMBOLS.includes(x));
    const symbols = requestedSymbols.length ? [...new Set(requestedSymbols)] : MONDAY_EQUITY_SYMBOLS;
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const timeframes = ['5Min', '15Min'];
    const variants = [
      { id: 'VALLEY_5M_Q50', timeframe: '5Min', kind: 'valley', q: 0.50, flatAtClose: false },
      { id: 'VALLEY_5M_Q60', timeframe: '5Min', kind: 'valley', q: 0.60, flatAtClose: false },
      { id: 'VALLEY_5M_Q60_STOP_2', timeframe: '5Min', kind: 'valley', q: 0.60, flatAtClose: false, emergencyStopPct: 2 },
      { id: 'VALLEY_5M_Q60_STOP_3', timeframe: '5Min', kind: 'valley', q: 0.60, flatAtClose: false, emergencyStopPct: 3 },
      { id: 'VALLEY_5M_Q60_STOP_5', timeframe: '5Min', kind: 'valley', q: 0.60, flatAtClose: false, emergencyStopPct: 5 },
      { id: 'VALLEY_5M_Q60_STOP_7_5', timeframe: '5Min', kind: 'valley', q: 0.60, flatAtClose: false, emergencyStopPct: 7.5 },
      { id: 'VALLEY_5M_Q60_STOP_10', timeframe: '5Min', kind: 'valley', q: 0.60, flatAtClose: false, emergencyStopPct: 10 },
      { id: 'VALLEY_5M_Q50_EOD', timeframe: '5Min', kind: 'valley', q: 0.50, flatAtClose: true },
      { id: 'VALLEY_15M_Q50', timeframe: '15Min', kind: 'valley', q: 0.50, flatAtClose: false },
      { id: 'TREND_MACD_5M_1ATR_2R', timeframe: '5Min', kind: 'trend', atrStop: 1.0, rewardRisk: 2.0 },
      { id: 'TREND_MACD_15M_1ATR_2R', timeframe: '15Min', kind: 'trend', atrStop: 1.0, rewardRisk: 2.0 },
    ];

    const barsByTf = {};
    for (const timeframe of timeframes) {
      const parts = await Promise.all(
        symbols.map(async (symbol) => {
          const one = await getStockBars('paper', [symbol], {
            timeframe, start, end, limit: 10000, feed: 'iex', sort: 'asc', maxPages: 2,
          });
          return [symbol, one[symbol] || []];
        })
      );
      barsByTf[timeframe] = Object.fromEntries(parts);
    }

    const results = [];
    for (const variant of variants) {
      const perSymbol = {};
      const recentCutoff = end.getTime() - 20 * 24 * 60 * 60 * 1000;
      const olderPerSymbol = {};
      const recentPerSymbol = {};
      for (const symbol of symbols) {
        const bars = barsByTf[variant.timeframe]?.[symbol] || [];
        const olderBars = bars.filter((b) => new Date(b?.t || b?.timestamp || 0).getTime() < recentCutoff);
        const recentBars = bars.filter((b) => new Date(b?.t || b?.timestamp || 0).getTime() >= recentCutoff);
        const runner = variant.kind === 'valley' ? backtestValleyCross : backtestTrendCross;
        const trades = runner(bars, variant);
        const olderTrades = runner(olderBars, variant);
        const recentTrades = runner(recentBars, variant);
        perSymbol[symbol] = { bars: bars.length, summary: btSummary(trades), trades };
        olderPerSymbol[symbol] = { summary: btSummary(olderTrades), trades: olderTrades };
        recentPerSymbol[symbol] = { summary: btSummary(recentTrades), trades: recentTrades };
      }
      results.push({
        id: variant.id,
        timeframe: variant.timeframe,
        aggregate: aggregateSymbolSummaries(perSymbol),
        olderWindow: aggregateSymbolSummaries(olderPerSymbol),
        recent20d: aggregateSymbolSummaries(recentPerSymbol),
        bySymbol: Object.fromEntries(Object.entries(perSymbol).map(([symbol, row]) => [symbol, { bars: row.bars, ...row.summary }])),
      });
    }

    results.sort((a, b) => {
      const robustA = Math.min(a.olderWindow.profitFactor || 0, a.recent20d.profitFactor || 0);
      const robustB = Math.min(b.olderWindow.profitFactor || 0, b.recent20d.profitFactor || 0);
      if (robustB !== robustA) return robustB - robustA;
      if (b.aggregate.positiveSymbols !== a.aggregate.positiveSymbols) return b.aggregate.positiveSymbols - a.aggregate.positiveSymbols;
      return b.aggregate.equalWeightSleevesReturnPct - a.aggregate.equalWeightSleevesReturnPct;
    });

    res.set('Cache-Control', 'no-store');
    return res.json({
      generatedAt: new Date().toISOString(),
      days,
      symbols,
      roundTripCostPct: 0.04,
      note: 'Research only. Uses next-bar entries and includes modeled round-trip cost.',
      results,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/crypto-protective-exit-backtest', async (req, res) => {
  try {
    const days = Math.max(90, Math.min(730, Math.floor(Number(req.query.days || 365))));
    const symbols = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'AVAX/USD', 'LTC/USD', 'BCH/USD', 'DOGE/USD'];
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const variants = [
      { id: 'MACD_ONLY', q: 0.50 },
      { id: 'STOP_3', q: 0.50, emergencyStopPct: 3 },
      { id: 'STOP_5', q: 0.50, emergencyStopPct: 5 },
      { id: 'STOP_8', q: 0.50, emergencyStopPct: 8 },
      { id: 'MAX_7D', q: 0.50, maxHoldBars: 168 },
      { id: 'STOP_3_MAX_7D', q: 0.50, emergencyStopPct: 3, maxHoldBars: 168 },
      { id: 'STOP_5_MAX_7D', q: 0.50, emergencyStopPct: 5, maxHoldBars: 168 },
      { id: 'STOP_8_MAX_7D', q: 0.50, emergencyStopPct: 8, maxHoldBars: 168 },
    ];

    const barsBySymbol = {};
    for (const symbol of symbols) {
      const result = await getCryptoBars('paper', [symbol], {
        timeframe: '1Hour', start, end, limit: 10000, sort: 'asc', maxPages: 5,
      });
      barsBySymbol[symbol] = result[symbol] || result[symbol.replace('/', '')] || [];
    }

    const results = variants.map((variant) => {
      const perSymbol = {};
      for (const symbol of symbols) {
        const bars = barsBySymbol[symbol] || [];
        const trades = backtestValleyCross(bars, {
          ...variant,
          lookback: 200,
          roundTripCostPct: 0.10,
        });
        perSymbol[symbol] = { bars: bars.length, summary: btSummary(trades), trades };
      }
      return {
        id: variant.id,
        aggregate: aggregateSymbolSummaries(perSymbol),
        bySymbol: Object.fromEntries(Object.entries(perSymbol).map(([symbol, row]) => [symbol, { bars: row.bars, ...row.summary }])),
      };
    });

    results.sort((a, b) => {
      if (b.aggregate.profitFactor !== a.aggregate.profitFactor) return b.aggregate.profitFactor - a.aggregate.profitFactor;
      return b.aggregate.equalWeightSleevesReturnPct - a.aggregate.equalWeightSleevesReturnPct;
    });

    res.set('Cache-Control', 'no-store');
    return res.json({
      generatedAt: new Date().toISOString(),
      days,
      symbols,
      timeframe: '1Hour',
      roundTripCostPct: 0.10,
      note: 'Research only. Closed-candle signals, next-bar entries/exits, modeled cost, gap-aware emergency stops.',
      results,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/crypto-breakout-backtest', async (req, res) => {
  try {
    const days = Math.max(180, Math.min(1095, Math.floor(Number(req.query.days || 365))));
    const end = req.query.end ? new Date(String(req.query.end)) : new Date();
    if (!Number.isFinite(end.getTime())) throw new Error('Invalid end date');
    const start = new Date(end.getTime() - days * 86400000);
    const symbols = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'AVAX/USD', 'LTC/USD', 'BCH/USD', 'DOGE/USD'];
    const variants = [
      { id: 'CHANNEL_20_10', entryBars: 20, exitBars: 10 },
      { id: 'CHANNEL_55_20', entryBars: 55, exitBars: 20 },
      { id: 'CHANNEL_100_40', entryBars: 100, exitBars: 40 },
    ];
    const barsBySymbol = {};
    for (const symbol of symbols) {
      const result = await getCryptoBars('paper', [symbol], {
        timeframe: '4Hour', start, end, limit: 10000, sort: 'asc', maxPages: 5,
      });
      barsBySymbol[symbol] = result[symbol] || result[symbol.replace('/', '')] || [];
    }
    const results = variants.map((variant) => {
      const perSymbol = {};
      for (const symbol of symbols) {
        const trades = backtestCryptoBreakout(barsBySymbol[symbol], { ...variant, roundTripCostPct: 0.50 });
        perSymbol[symbol] = { bars: barsBySymbol[symbol].length, summary: btSummary(trades), trades };
      }
      return {
        id: variant.id,
        aggregate: aggregateSymbolSummaries(perSymbol),
        bySymbol: Object.fromEntries(Object.entries(perSymbol).map(([symbol, row]) => [symbol, { bars: row.bars, ...row.summary }])),
      };
    });
    res.set('Cache-Control', 'no-store');
    return res.json({
      generatedAt: new Date().toISOString(), researchOnly: true, timeframe: '4Hour',
      start: start.toISOString(), end: end.toISOString(), days, symbols,
      roundTripCostPct: 0.50,
      execution: 'completed candle; next 4h open; long only; no lookahead',
      results,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});


router.get('/crypto-daily-pullback-backtest', async (req, res) => {
  try {
    const days = Math.max(365, Math.min(1460, Math.floor(Number(req.query.days || 365))));
    const end = req.query.end ? new Date(String(req.query.end)) : new Date();
    if (!Number.isFinite(end.getTime())) throw new Error('Invalid end date');
    const warmupStart = new Date(end.getTime() - (days + 260) * 86400000);
    const start = new Date(end.getTime() - days * 86400000);
    const symbols = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'AVAX/USD', 'LTC/USD', 'BCH/USD', 'DOGE/USD'];
    const variants = [
      { id: 'RSI2_5', entryRsi: 5 },
      { id: 'RSI2_10', entryRsi: 10 },
      { id: 'RSI2_15', entryRsi: 15 },
    ];
    const barsBySymbol = {};
    for (const symbol of symbols) {
      const result = await getCryptoBars('paper', [symbol], {
        timeframe: '1Day', start: warmupStart, end, limit: 10000, sort: 'asc', maxPages: 2,
      });
      const all = result[symbol] || result[symbol.replace('/', '')] || [];
      barsBySymbol[symbol] = all;
    }
    const results = variants.map((variant) => {
      const perSymbol = {};
      for (const symbol of symbols) {
        const trades = backtestCryptoDailyPullback(barsBySymbol[symbol], { ...variant, exitRsi: 70, maxHoldBars: 5, roundTripCostPct: 0.50, startMs: start.getTime() });
        perSymbol[symbol] = { bars: barsBySymbol[symbol].length, summary: btSummary(trades), trades };
      }
      return {
        id: variant.id,
        aggregate: aggregateSymbolSummaries(perSymbol),
        bySymbol: Object.fromEntries(Object.entries(perSymbol).map(([symbol, row]) => [symbol, { bars: row.bars, ...row.summary }])),
      };
    });
    res.set('Cache-Control', 'no-store');
    return res.json({
      generatedAt: new Date().toISOString(), researchOnly: true, timeframe: '1Day',
      start: start.toISOString(), end: end.toISOString(), days, symbols,
      roundTripCostPct: 0.50,
      execution: 'completed daily candle; next daily open; long only; close above SMA200; RSI2 pullback; RSI2 rebound or five-day exit',
      results,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});


router.get('/crypto-regime-breakout-backtest', async (req, res) => {
  try {
    const days = Math.max(365, Math.min(1095, Math.floor(Number(req.query.days || 365))));
    const end = req.query.end ? new Date(String(req.query.end)) : new Date();
    if (!Number.isFinite(end.getTime())) throw new Error('Invalid end date');
    const start = new Date(end.getTime() - days * 86400000);
    const warmup = new Date(start.getTime() - 260 * 86400000);
    const symbols = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'AVAX/USD', 'LTC/USD', 'BCH/USD', 'DOGE/USD'];
    const variants = [
      { id: 'CH20_10_MILD', entryBars: 20, exitBars: 10, regime: 'mild' },
      { id: 'CH20_10_STRONG', entryBars: 20, exitBars: 10, regime: 'strong' },
      { id: 'CH55_20_MILD', entryBars: 55, exitBars: 20, regime: 'mild' },
      { id: 'CH55_20_STRONG', entryBars: 55, exitBars: 20, regime: 'strong' },
    ];
    const dailyResult = await getCryptoBars('paper', ['BTC/USD'], {
      timeframe: '1Day', start: warmup, end, limit: 10000, sort: 'asc', maxPages: 2,
    });
    const btcDaily = dailyResult['BTC/USD'] || dailyResult.BTCUSD || [];
    const barsBySymbol = {};
    for (const symbol of symbols) {
      const hourly = await fetchCryptoHourlyComplete(symbol, warmup, end);
      barsBySymbol[symbol] = aggregateCryptoFourHour(hourly);
    }
    const results = variants.map((variant) => {
      const perSymbol = {};
      for (const symbol of symbols) {
        const trades = backtestCryptoBreakoutWithRegime(barsBySymbol[symbol], btcDaily, {
          ...variant, roundTripCostPct: 0.50, startMs: start.getTime(),
        });
        perSymbol[symbol] = { bars: barsBySymbol[symbol].length, summary: btSummary(trades), trades };
      }
      return {
        id: variant.id,
        aggregate: aggregateSymbolSummaries(perSymbol),
        bySymbol: Object.fromEntries(Object.entries(perSymbol).map(([symbol, row]) => [symbol, { bars: row.bars, ...row.summary }])),
      };
    });
    res.set('Cache-Control', 'no-store');
    return res.json({
      generatedAt: new Date().toISOString(), researchOnly: true, timeframe: '4Hour',
      start: start.toISOString(), end: end.toISOString(), days, symbols,
      roundTripCostPct: 0.50,
      btcDailyBars: btcDaily.length,
      dataCounts: Object.fromEntries(Object.entries(barsBySymbol).map(([symbol, rows]) => [symbol, rows.length])),
      regimes: { mild: 'prior completed BTC daily close above SMA150 and 30d momentum above 0', strong: 'same with 30d momentum above 5%' },
      results,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
