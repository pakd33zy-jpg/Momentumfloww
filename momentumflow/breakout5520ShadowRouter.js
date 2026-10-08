import express from 'express';
import fetch from 'node-fetch';
import { getCredentials } from './alpacaClient.js';
import { store } from './store.js';
import { persistConfig } from './persistentCredentialStore.js';

const router = express.Router();
const STORE_KEY = 'breakout5520ShadowState';
const DATA_BASE = 'https://data.alpaca.markets';
const SYMBOLS = [
  'SPY','QQQ','IWM','DIA','AAPL','MSFT','NVDA','AMZN','META','TSLA',
  'AMD','GOOGL','NFLX','AVGO','INTC','MU','ORCL','CRM','ADBE','PLTR',
  'JPM','BAC','WFC','GS','V','MA','XOM','CVX','COP','SLB',
  'WMT','COST','HD','LOW','DIS','NKE','UBER','ABNB','BA','CAT',
  'GE','F','GM','PFE','LLY','UNH','JNJ','KO','PEP','T',
  'XLK','XLF','XLE','XLV','XLY','XLP','XLI','XLU','XLB','XLC',
  'QCOM','TXN','AMAT','LRCX','KLAC','MRVL','CSCO','IBM','NOW','SNOW',
  'C','SCHW','MS','AXP','COF','OXY','MPC','PSX','HAL','EOG',
  'MCD','SBUX','TGT','TJX','BKNG','DE','UPS','RTX','LMT','HON',
  'ABBV','MRK','TMO','ABT','MDT','CMCSA','VZ','SHOP','SNAP','ROKU',
];
const UNIVERSE_VERSION = 'LIQUID100_V1';
const ENTRY = 55;
const EXIT = 20;
const ROUND_TRIP_COST_PCT = 0.04;
const VIRTUAL_PORTFOLIO_VERSION = 'V2_2_5PCT_MARKED';
const VIRTUAL_STARTING_CAPITAL = 100;
const VIRTUAL_POSITION_FRACTION = 0.025;
const runtime = {
  running: false,
  busy: false,
  timer: null,
  lastTickAt: null,
  lastDecision: '55/20 shadow stopped',
  lastError: null,
};

function emptyState() {
  return {
    startedAt: null,
    lastProcessedBar: null,
    pendingEntries: {},
    pendingExits: {},
    positions: {},
    closedTrades: [],
    updatedAt: null,
    universeVersion: null,
    virtualPortfolio: null,
  };
}

function state() {
  return { ...emptyState(), ...store.getConfig(STORE_KEY, {}) };
}

async function save(patch) {
  const next = { ...state(), ...patch, updatedAt: new Date().toISOString() };
  store.setConfig(STORE_KEY, next);
  try { await persistConfig(STORE_KEY, next); } catch (e) { console.warn('[55-20-shadow] persist skipped:', e.message); }
  return next;
}

function headers() {
  const c = getCredentials('paper');
  if (!c) throw new Error('No Alpaca paper credentials configured');
  return { 'APCA-API-KEY-ID': c.keyId, 'APCA-API-SECRET-KEY': c.secretKey };
}

async function bars(symbol) {
  const end = new Date();
  const start = new Date(end.getTime() - 220 * 86400000);
  const qs = new URLSearchParams({
    timeframe: '1Day', start: start.toISOString(), end: end.toISOString(),
    feed: 'iex', adjustment: 'all', sort: 'asc', limit: '1000',
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

function ts(bar) { return new Date(bar?.t || 0).getTime(); }
function px(bar, key) { return Number(bar?.[key] || 0); }

function nyParts(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

function nyDateKey(ms) {
  const p = nyParts(ms);
  return `${p.year}-${p.month}-${p.day}`;
}

function isCompletedDailyBar(barTs, nowMs = Date.now()) {
  const barDate = nyDateKey(barTs);
  const now = nyParts(nowMs);
  const today = `${now.year}-${now.month}-${now.day}`;
  if (barDate < today) return true;
  if (barDate > today) return false;
  const minuteOfDay = Number(now.hour) * 60 + Number(now.minute);
  return minuteOfDay >= (16 * 60 + 15);
}


function makeVirtualPortfolio(existingPositions = {}) {
  const vp = {
    version: VIRTUAL_PORTFOLIO_VERSION,
    startingCapital: VIRTUAL_STARTING_CAPITAL,
    positionFraction: VIRTUAL_POSITION_FRACTION,
    cash: VIRTUAL_STARTING_CAPITAL,
    equity: VIRTUAL_STARTING_CAPITAL,
    peakEquity: VIRTUAL_STARTING_CAPITAL,
    maxDrawdownPct: 0,
    realizedPnl: 0,
    positions: {},
    bootstrappedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const rows = Object.values(existingPositions || {}).sort((a, b) => {
    const dt = new Date(a?.entryTimestamp || 0).getTime() - new Date(b?.entryTimestamp || 0).getTime();
    return dt || String(a?.symbol || '').localeCompare(String(b?.symbol || ''));
  });
  for (const pos of rows) {
    const entryPrice = Number(pos?.entryPrice || 0);
    if (!(entryPrice > 0)) continue;
    const target = VIRTUAL_STARTING_CAPITAL * VIRTUAL_POSITION_FRACTION;
    if (vp.cash + 1e-12 < target) break;
    const shares = target / entryPrice;
    vp.cash -= target;
    vp.positions[pos.symbol] = {
      symbol: pos.symbol,
      shares,
      entryPrice,
      costBasis: target,
      entryTimestamp: pos.entryTimestamp,
      entrySignalTimestamp: pos.entrySignalTimestamp,
      lastMark: entryPrice,
    };
  }
  const exposure = Object.values(vp.positions).reduce((sum, pos) => sum + Number(pos.costBasis || 0), 0);
  vp.grossExposure = exposure;
  vp.grossExposurePct = VIRTUAL_STARTING_CAPITAL > 0 ? exposure / VIRTUAL_STARTING_CAPITAL * 100 : 0;
  vp.cashPct = VIRTUAL_STARTING_CAPITAL > 0 ? vp.cash / VIRTUAL_STARTING_CAPITAL * 100 : 0;
  vp.returnPct = 0;
  return vp;
}

function virtualEquityAt(vp, barsBySymbol, barTs, priceKey = 'c') {
  let equity = Number(vp?.cash || 0);
  let exposure = 0;
  for (const [symbol, pos] of Object.entries(vp?.positions || {})) {
    const rows = barsBySymbol[symbol] || [];
    const bar = rows.find((b) => ts(b) === barTs);
    const mark = Number(bar?.[priceKey] || bar?.c || bar?.o || pos.lastMark || pos.entryPrice || 0);
    if (mark > 0) pos.lastMark = mark;
    const mv = Number(pos.shares || 0) * Number(pos.lastMark || 0);
    equity += mv;
    exposure += mv;
  }
  return { equity, exposure };
}

function markVirtualPortfolio(vp, barsBySymbol, barTs) {
  const { equity, exposure } = virtualEquityAt(vp, barsBySymbol, barTs, 'c');
  vp.equity = equity;
  vp.peakEquity = Math.max(Number(vp.peakEquity || VIRTUAL_STARTING_CAPITAL), equity);
  const dd = vp.peakEquity > 0 ? (1 - equity / vp.peakEquity) * 100 : 0;
  vp.maxDrawdownPct = Math.max(Number(vp.maxDrawdownPct || 0), dd);
  vp.grossExposure = exposure;
  vp.grossExposurePct = equity > 0 ? exposure / equity * 100 : 0;
  vp.cashPct = equity > 0 ? Number(vp.cash || 0) / equity * 100 : 0;
  vp.returnPct = (equity / Number(vp.startingCapital || VIRTUAL_STARTING_CAPITAL) - 1) * 100;
  vp.updatedAt = new Date().toISOString();
  return vp;
}

function summarizeClosed(trades = []) {
  let wins = 0, gw = 0, gl = 0, sum = 0;
  for (const t of trades) {
    const r = Number(t.returnPct || 0) / 100;
    sum += r;
    if (r > 0) { wins += 1; gw += r; } else if (r < 0) gl += Math.abs(r);
  }
  return {
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    winRatePct: trades.length ? Number((wins / trades.length * 100).toFixed(2)) : 0,
    profitFactor: gl > 0 ? Number((gw / gl).toFixed(3)) : (gw > 0 ? 999 : 0),
    avgTradePct: trades.length ? Number((sum / trades.length * 100).toFixed(4)) : 0,
  };
}

function processBarTimestamp(current, barsBySymbol, barTs, { evaluateSignals = true, markProcessed = true } = {}) {
  const pendingEntries = { ...(current.pendingEntries || {}) };
  const pendingExits = { ...(current.pendingExits || {}) };
  const positions = { ...(current.positions || {}) };
  const closedTrades = [...(current.closedTrades || [])];
  const sideCost = ROUND_TRIP_COST_PCT / 200;
  const virtualPortfolio = current.virtualPortfolio?.version === VIRTUAL_PORTFOLIO_VERSION
    ? {
        ...current.virtualPortfolio,
        positions: { ...(current.virtualPortfolio.positions || {}) },
      }
    : makeVirtualPortfolio(positions);
  let entered = 0, exited = 0, armedEntries = 0, armedExits = 0;
  let virtualEntered = 0, virtualExited = 0, virtualSkippedForCash = 0;

  for (const symbol of SYMBOLS) {
    const rows = barsBySymbol[symbol] || [];
    const i = rows.findIndex((b) => ts(b) === barTs);
    if (i < 0) continue;
    const bar = rows[i];

    const pe = pendingExits[symbol];
    if (pe && Number(pe.signalTimestamp) < barTs && positions[symbol]) {
      const rawExit = px(bar, 'o');
      if (rawExit > 0) {
        const exitPrice = rawExit * (1 - sideCost);
        const pos = positions[symbol];
        const returnPct = (exitPrice / Number(pos.entryPrice) - 1) * 100;
        const virtualPos = virtualPortfolio.positions[symbol];
        if (virtualPos) {
          const proceeds = Number(virtualPos.shares || 0) * exitPrice;
          virtualPortfolio.cash = Number(virtualPortfolio.cash || 0) + proceeds;
          virtualPortfolio.realizedPnl = Number(virtualPortfolio.realizedPnl || 0) + (proceeds - Number(virtualPos.costBasis || 0));
          delete virtualPortfolio.positions[symbol];
          virtualExited += 1;
        }
        closedTrades.push({
          symbol,
          strategy: 'DAILY_55_20_LIQUID100_SHADOW',
          entryTimestamp: pos.entryTimestamp,
          entryPrice: pos.entryPrice,
          exitTimestamp: bar.t,
          exitPrice,
          returnPct: Number(returnPct.toFixed(4)),
          entrySignalTimestamp: pos.entrySignalTimestamp,
          exitSignalTimestamp: pe.signalTimestamp,
        });
        delete positions[symbol];
        delete pendingExits[symbol];
        exited += 1;
      }
    }

    const pen = pendingEntries[symbol];
    if (pen && Number(pen.signalTimestamp) < barTs && !positions[symbol]) {
      const rawEntry = px(bar, 'o');
      if (rawEntry > 0) {
        const entryPrice = rawEntry * (1 + sideCost);
        positions[symbol] = {
          symbol,
          entryTimestamp: bar.t,
          entryPrice,
          entrySignalTimestamp: pen.signalTimestamp,
        };
        const { equity: equityAtOpen } = virtualEquityAt(virtualPortfolio, barsBySymbol, barTs, 'o');
        const target = equityAtOpen * VIRTUAL_POSITION_FRACTION;
        if (target > 0 && Number(virtualPortfolio.cash || 0) + 1e-12 >= target) {
          virtualPortfolio.positions[symbol] = {
            symbol,
            shares: target / entryPrice,
            entryPrice,
            costBasis: target,
            entryTimestamp: bar.t,
            entrySignalTimestamp: pen.signalTimestamp,
            lastMark: entryPrice,
          };
          virtualPortfolio.cash = Number(virtualPortfolio.cash || 0) - target;
          virtualEntered += 1;
        } else {
          virtualSkippedForCash += 1;
        }
        delete pendingEntries[symbol];
        entered += 1;
      }
    }

    if (!evaluateSignals) continue;
    if (i < ENTRY) continue;
    const close = px(bar, 'c');
    if (!(close > 0)) continue;

    if (positions[symbol] && !pendingExits[symbol] && i >= EXIT) {
      const low20 = Math.min(...rows.slice(i - EXIT, i).map((b) => px(b, 'l')).filter((n) => n > 0));
      if (Number.isFinite(low20) && close < low20) {
        pendingExits[symbol] = { signalTimestamp: barTs, signalClose: close };
        armedExits += 1;
      }
      continue;
    }

    if (!positions[symbol] && !pendingEntries[symbol] && !pendingExits[symbol]) {
      const high55 = Math.max(...rows.slice(i - ENTRY, i).map((b) => px(b, 'h')).filter((n) => n > 0));
      if (Number.isFinite(high55) && close > high55) {
        pendingEntries[symbol] = { signalTimestamp: barTs, signalClose: close };
        armedEntries += 1;
      }
    }
  }

  markVirtualPortfolio(virtualPortfolio, barsBySymbol, barTs);

  return {
    ...current,
    pendingEntries,
    pendingExits,
    positions,
    virtualPortfolio,
    closedTrades: closedTrades.slice(-5000),
    lastProcessedBar: markProcessed ? barTs : current.lastProcessedBar,
    lastCycle: { barTimestamp: barTs, entered, exited, armedEntries, armedExits, virtualEntered, virtualExited, virtualSkippedForCash },
  };
}

async function tick() {
  if (!runtime.running || runtime.busy) return;
  runtime.busy = true;
  try {
    runtime.lastTickAt = new Date().toISOString();
    runtime.lastError = null;
    if (!getCredentials('paper')) throw new Error('No Alpaca paper credentials configured');

    const fetched = await mapLimit(SYMBOLS, 5, async (s) => [s, await bars(s)]);
    const barsBySymbol = Object.fromEntries(fetched);
    const spy = barsBySymbol.SPY || [];
    const timestamps = spy.map(ts).filter((n) => n > 0).sort((a, b) => a - b);
    const completedTimestamps = timestamps.filter((n) => isCompletedDailyBar(n));
    if (!completedTimestamps.length) throw new Error('No completed SPY daily bars returned');

    let current = state();
    const latestCompleted = completedTimestamps[completedTimestamps.length - 1];
    const latestSeen = timestamps[timestamps.length - 1];
    if (!current.startedAt) current = await save({ ...current, startedAt: new Date().toISOString() });
    if (current.virtualPortfolio?.version !== VIRTUAL_PORTFOLIO_VERSION) {
      const virtualPortfolio = makeVirtualPortfolio(current.positions || {});
      markVirtualPortfolio(virtualPortfolio, barsBySymbol, latestSeen || latestCompleted);
      current = await save({ ...current, virtualPortfolio });
    }

    let todo;
    if (!current.lastProcessedBar) {
      todo = [latestCompleted];
    } else if (current.universeVersion !== UNIVERSE_VERSION) {
      todo = [latestCompleted];
    } else {
      todo = completedTimestamps.filter((n) => n > Number(current.lastProcessedBar));
    }

    for (const barTs of todo) {
      current = processBarTimestamp(current, barsBySymbol, barTs, { evaluateSignals: true, markProcessed: true });
    }

    let liveExecution = null;
    if (latestSeen > latestCompleted && latestSeen > Number(current.lastProcessedBar || 0)) {
      current = processBarTimestamp(current, barsBySymbol, latestSeen, { evaluateSignals: false, markProcessed: false });
      liveExecution = current.lastCycle || null;
    }

    if (todo.length || liveExecution) {
      current = await save({ ...current, universeVersion: UNIVERSE_VERSION });
    }

    if (!todo.length) {
      const fillNote = liveExecution && (liveExecution.entered || liveExecution.exited)
        ? `; today-open shadow fills: +${liveExecution.entered || 0}/-${liveExecution.exited || 0}`
        : '';
      runtime.lastDecision = `55/20 SHADOW current through completed ${new Date(latestCompleted).toISOString().slice(0, 10)}${fillNote}; ${Object.keys(current.positions || {}).length} open, ${Object.keys(current.pendingEntries || {}).length} entries armed, ${Object.keys(current.pendingExits || {}).length} exits armed`;
      return;
    }

    const last = current.lastCycle || {};
    runtime.lastDecision = `55/20 SHADOW processed ${todo.length} completed day(s); entered ${last.entered || 0}, exited ${last.exited || 0}, armed ${last.armedEntries || 0} entries/${last.armedExits || 0} exits; ${Object.keys(current.positions || {}).length} open`;
  } catch (e) {
    runtime.lastError = e.message;
    runtime.lastDecision = `55/20 shadow error: ${e.message}`;
    console.error('[55-20-shadow]', e);
  } finally {
    runtime.busy = false;
    schedule();
  }
}

function schedule() {
  if (!runtime.running) return;
  runtime.timer = setTimeout(tick, 60 * 60 * 1000);
  runtime.timer.unref?.();
}

export function startBreakout5520Shadow() {
  if (runtime.running) return;
  runtime.running = true;
  runtime.lastDecision = '55/20 SHADOW starting';
  setTimeout(tick, 3000).unref?.();
}

function status() {
  const s = state();
  return {
    running: runtime.running,
    mode: 'paper-shadow',
    placesOrders: false,
    strategy: 'DAILY_55_20_LIQUID100_SHADOW',
    symbols: SYMBOLS,
    universeVersion: UNIVERSE_VERSION,
    rules: { entryLookbackBars: ENTRY, exitLookbackBars: EXIT, timeframe: '1Day', direction: 'long-only', roundTripCostPct: ROUND_TRIP_COST_PCT },
    lastTickAt: runtime.lastTickAt,
    lastDecision: runtime.lastDecision,
    lastError: runtime.lastError,
    openPositionCount: Object.keys(s.positions || {}).length,
    pendingEntryCount: Object.keys(s.pendingEntries || {}).length,
    pendingExitCount: Object.keys(s.pendingExits || {}).length,
    ...s,
    performance: summarizeClosed(s.closedTrades || []),
    virtualPortfolio: s.virtualPortfolio ? {
      version: s.virtualPortfolio.version,
      startingCapital: Number(s.virtualPortfolio.startingCapital || 0),
      positionFractionPct: Number((Number(s.virtualPortfolio.positionFraction || 0) * 100).toFixed(2)),
      cash: Number(Number(s.virtualPortfolio.cash || 0).toFixed(4)),
      equity: Number(Number(s.virtualPortfolio.equity || 0).toFixed(4)),
      returnPct: Number(Number(s.virtualPortfolio.returnPct || 0).toFixed(3)),
      peakEquity: Number(Number(s.virtualPortfolio.peakEquity || 0).toFixed(4)),
      maxDrawdownPct: Number(Number(s.virtualPortfolio.maxDrawdownPct || 0).toFixed(3)),
      realizedPnl: Number(Number(s.virtualPortfolio.realizedPnl || 0).toFixed(4)),
      grossExposurePct: Number(Number(s.virtualPortfolio.grossExposurePct || 0).toFixed(2)),
      cashPct: Number(Number(s.virtualPortfolio.cashPct || 0).toFixed(2)),
      openPositionCount: Object.keys(s.virtualPortfolio.positions || {}).length,
      positions: s.virtualPortfolio.positions || {},
      bootstrappedAt: s.virtualPortfolio.bootstrappedAt || null,
      updatedAt: s.virtualPortfolio.updatedAt || null,
    } : null,
  };
}

router.get('/status', (req, res) => res.json(status()));
router.post('/start', (req, res) => { startBreakout5520Shadow(); res.json(status()); });
router.post('/stop', (req, res) => {
  if (runtime.timer) clearTimeout(runtime.timer);
  runtime.timer = null;
  runtime.running = false;
  runtime.lastDecision = '55/20 SHADOW stopped';
  res.json(status());
});
router.post('/tick', async (req, res) => {
  if (!runtime.running) startBreakout5520Shadow();
  await tick();
  res.json(status());
});

export default router;
