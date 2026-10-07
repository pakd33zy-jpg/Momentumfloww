import express from 'express';
import fetch from 'node-fetch';
import { getCredentials } from './alpacaClient.js';
import { store } from './store.js';
import { persistConfig } from './persistentCredentialStore.js';

const router = express.Router();
const STORE_KEY = 'breakout5520Validation50ShadowState';
const DATA_BASE = 'https://data.alpaca.markets';
const SYMBOLS = [
  'MMM','AXP','AMGN','AAPL','BA','CAT','CVX','CSCO','KO','DIS',
  'DOW','GS','HD','HON','IBM','INTC','JNJ','JPM','MCD','MRK',
  'MSFT','NKE','PG','CRM','TRV','UNH','VZ','V','WBA','WMT',
  'SPY','QQQ','IWM','DIA','XLK','XLF','XLE','XLV','XLY','XLP',
  'XLI','XLU','XLB','XLC','GLD','SLV','TLT','HYG','EEM','EFA',
];
const UNIVERSE_VERSION = 'VALIDATION50_V1';
const ENTRY = 55;
const EXIT = 20;
const ROUND_TRIP_COST_PCT = 0.04;
const runtime = {
  running: false,
  busy: false,
  timer: null,
  lastTickAt: null,
  lastDecision: '55/20 validation50 shadow stopped',
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
  };
}

function state() {
  return { ...emptyState(), ...store.getConfig(STORE_KEY, {}) };
}

async function save(patch) {
  const next = { ...state(), ...patch, updatedAt: new Date().toISOString() };
  store.setConfig(STORE_KEY, next);
  try { await persistConfig(STORE_KEY, next); } catch (e) { console.warn('[55-20-validation50-shadow] persist skipped:', e.message); }
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

function processBarTimestamp(current, barsBySymbol, barTs) {
  const pendingEntries = { ...(current.pendingEntries || {}) };
  const pendingExits = { ...(current.pendingExits || {}) };
  const positions = { ...(current.positions || {}) };
  const closedTrades = [...(current.closedTrades || [])];
  const sideCost = ROUND_TRIP_COST_PCT / 200;
  let entered = 0, exited = 0, armedEntries = 0, armedExits = 0;

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
        closedTrades.push({
          symbol,
          strategy: 'DAILY_55_20_VALIDATION50_SHADOW',
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
        positions[symbol] = {
          symbol,
          entryTimestamp: bar.t,
          entryPrice: rawEntry * (1 + sideCost),
          entrySignalTimestamp: pen.signalTimestamp,
        };
        delete pendingEntries[symbol];
        entered += 1;
      }
    }

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

  return {
    ...current,
    pendingEntries,
    pendingExits,
    positions,
    closedTrades: closedTrades.slice(-5000),
    lastProcessedBar: barTs,
    lastCycle: { barTimestamp: barTs, entered, exited, armedEntries, armedExits },
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
    if (!timestamps.length) throw new Error('No completed SPY daily bars returned');

    let current = state();
    const latest = timestamps[timestamps.length - 1];
    if (!current.startedAt) current = await save({ ...current, startedAt: new Date().toISOString() });

    let todo;
    if (!current.lastProcessedBar) {
      todo = [latest];
    } else if (current.universeVersion !== UNIVERSE_VERSION) {
      // Re-evaluate the latest completed bar once when expanding the universe.
      // Existing positions/pending signals are idempotent; this only allows newly
      // added symbols to catch signals from the most recent completed session.
      todo = [latest];
    } else {
      todo = timestamps.filter((n) => n > Number(current.lastProcessedBar));
    }

    if (!todo.length) {
      runtime.lastDecision = `55/20 VALIDATION50 SHADOW current through ${new Date(latest).toISOString().slice(0, 10)}; ${Object.keys(current.positions || {}).length} open, ${Object.keys(current.pendingEntries || {}).length} entries armed, ${Object.keys(current.pendingExits || {}).length} exits armed`;
      return;
    }

    for (const barTs of todo) current = processBarTimestamp(current, barsBySymbol, barTs);
    current = await save({ ...current, universeVersion: UNIVERSE_VERSION });
    const last = current.lastCycle || {};
    runtime.lastDecision = `55/20 VALIDATION50 SHADOW processed ${todo.length} day(s); entered ${last.entered || 0}, exited ${last.exited || 0}, armed ${last.armedEntries || 0} entries/${last.armedExits || 0} exits; ${Object.keys(current.positions || {}).length} open`;
  } catch (e) {
    runtime.lastError = e.message;
    runtime.lastDecision = `55/20 validation50 shadow error: ${e.message}`;
    console.error('[55-20-validation50-shadow]', e);
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

export function startBreakout5520Validation50Shadow() {
  if (runtime.running) return;
  runtime.running = true;
  runtime.lastDecision = '55/20 VALIDATION50 SHADOW starting';
  setTimeout(tick, 3000).unref?.();
}

function status() {
  const s = state();
  return {
    running: runtime.running,
    mode: 'paper-shadow',
    placesOrders: false,
    strategy: 'DAILY_55_20_VALIDATION50_SHADOW',
    symbols: SYMBOLS,
    universeVersion: UNIVERSE_VERSION,
    rules: { entryLookbackBars: ENTRY, exitLookbackBars: EXIT, timeframe: '1Day', direction: 'long-only', roundTripCostPct: ROUND_TRIP_COST_PCT },
    lastTickAt: runtime.lastTickAt,
    lastDecision: runtime.lastDecision,
    lastError: runtime.lastError,
    openPositionCount: Object.keys(s.positions || {}).length,
    pendingEntryCount: Object.keys(s.pendingEntries || {}).length,
    pendingExitCount: Object.keys(s.pendingExits || {}).length,
    performance: summarizeClosed(s.closedTrades || []),
    ...s,
  };
}

router.get('/status', (req, res) => res.json(status()));
router.post('/start', (req, res) => { startBreakout5520Validation50Shadow(); res.json(status()); });
router.post('/stop', (req, res) => {
  if (runtime.timer) clearTimeout(runtime.timer);
  runtime.timer = null;
  runtime.running = false;
  runtime.lastDecision = '55/20 VALIDATION50 SHADOW stopped';
  res.json(status());
});
router.post('/tick', async (req, res) => {
  if (!runtime.running) startBreakout5520Validation50Shadow();
  await tick();
  res.json(status());
});

export default router;
