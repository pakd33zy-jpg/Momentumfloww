import express from 'express';
import { store } from './store.js';
import { getMarketClock, getStockBars, hasCredentials } from './alpacaClient.js';
import {
  EQUITY_V71_DEFAULTS,
  evaluateEquityV71,
  nextBarOpen,
  settleV71ShadowTrade,
  timedExitClose,
} from './equityStrategyV71.js';

const router = express.Router();
const MODE = 'paper';
const STORE_KEY = 'equityV71ShadowState';
const runtime = { running: false, timer: null, busy: false, lastTickAt: null, lastDecision: 'V71 shadow stopped', lastError: null };

function config() {
  return { ...EQUITY_V71_DEFAULTS, pollSeconds: 30, ...store.getConfig('equityV71ShadowConfig', {}) };
}
function persisted() {
  return store.getConfig(STORE_KEY, { lastSignalTimestamp: null, pendingBatch: null, activeBatch: null, closedTrades: [] });
}
function save(patch) {
  const next = { ...persisted(), ...patch, updatedAt: new Date().toISOString() };
  store.setConfig(STORE_KEY, next);
  return next;
}
function ts(bar) {
  return new Date(bar?.t ?? bar?.timestamp ?? 0).getTime();
}
function latestCompletedEligibleTimestamp(spyBars = [], now = Date.now()) {
  return spyBars
    .map((bar) => ts(bar))
    .filter((value) => value > 0 && value + 30 * 60_000 <= now - 5_000)
    .filter((value) => {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date(value));
      const p = Object.fromEntries(parts.filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
      return p.hour === '13' && (p.minute === '00' || p.minute === '30');
    })
    .sort((a, b) => b - a)[0] ?? null;
}
async function bars() {
  return getStockBars(MODE, config().symbols, {
    timeframe: '30Min',
    start: new Date(Date.now() - 7 * 24 * 3600_000),
    end: new Date(),
    limit: 10000,
    feed: 'iex',
  });
}
function settleActive(state, barsBySymbol) {
  if (!state.activeBatch) return state;
  const results = [];
  for (const trade of state.activeBatch.trades) {
    const exit = timedExitClose(barsBySymbol[trade.symbol], state.activeBatch.signalTimestamp);
    if (!exit) return state;
    results.push({
      ...trade,
      exitTimestamp: exit.timestamp,
      exitPrice: exit.price,
      returnPct: settleV71ShadowTrade({ entryPrice: trade.entryPrice, exitPrice: exit.price, config: config() }),
    });
  }
  const closedTrades = [...(state.closedTrades || []), ...results].slice(-1000);
  const batchReturnPct = results.reduce((sum, row) => sum + row.returnPct, 0) / Math.max(1, results.length);
  runtime.lastDecision = `V71 SHADOW closed ${results.length} positions; equal-weight return ${batchReturnPct.toFixed(3)}%`;
  return save({ activeBatch: null, closedTrades, lastClosedBatch: { signalTimestamp: state.activeBatch.signalTimestamp, batchReturnPct, trades: results } });
}
function enterPending(state, barsBySymbol) {
  if (!state.pendingBatch || state.activeBatch) return state;
  const trades = [];
  for (const signal of state.pendingBatch.signals) {
    const entry = nextBarOpen(barsBySymbol[signal.symbol], state.pendingBatch.signalTimestamp);
    if (!entry) return state;
    trades.push({ ...signal, entryTimestamp: entry.timestamp, entryPrice: entry.price });
  }
  runtime.lastDecision = `V71 SHADOW entered ${trades.length}: ${trades.map((x) => x.symbol).join(', ')}`;
  return save({
    pendingBatch: null,
    activeBatch: {
      signalTimestamp: state.pendingBatch.signalTimestamp,
      openedAt: new Date().toISOString(),
      closeAfter: new Date(Math.max(...trades.map((x) => x.entryTimestamp)) + config().holdMinutes * 60_000).toISOString(),
      trades,
    },
  });
}
async function tick() {
  if (!runtime.running || runtime.busy) return;
  runtime.busy = true;
  try {
    runtime.lastTickAt = new Date().toISOString();
    runtime.lastError = null;
    if (!hasCredentials(MODE)) throw new Error('No Alpaca paper credentials configured');
    const clock = await getMarketClock(MODE);
    if (!clock?.is_open) {
      runtime.lastDecision = 'V71 SHADOW waiting for equity market';
      return;
    }
    const barsBySymbol = await bars();
    let state = settleActive(persisted(), barsBySymbol);
    state = enterPending(state, barsBySymbol);
    if (state.activeBatch || state.pendingBatch) return;
    const signalTimestamp = latestCompletedEligibleTimestamp(barsBySymbol.SPY);
    if (!signalTimestamp || signalTimestamp === state.lastSignalTimestamp) {
      runtime.lastDecision = 'V71 SHADOW waiting for completed 13:00/13:30 ET signal bar';
      return;
    }
    const decision = evaluateEquityV71({ barsBySymbol, signalTimestamp, config: config() });
    save({
      lastSignalTimestamp: signalTimestamp,
      lastEvaluation: { at: new Date().toISOString(), signalTimestamp, reason: decision.reason, diagnostics: decision.diagnostics },
      pendingBatch: decision.signals.length ? { signalTimestamp, signals: decision.signals } : null,
    });
    runtime.lastDecision = decision.signals.length
      ? `V71 SHADOW armed ${decision.signals.length}: ${decision.signals.map((x) => x.symbol).join(', ')}`
      : decision.reason;
  } catch (error) {
    runtime.lastError = error.message;
    runtime.lastDecision = `V71 shadow error: ${error.message}`;
    console.error('[equity-v71-shadow]', error);
  } finally {
    runtime.busy = false;
    schedule();
  }
}
function schedule() {
  if (!runtime.running) return;
  runtime.timer = setTimeout(tick, Math.max(10_000, Number(config().pollSeconds) * 1000));
  runtime.timer.unref?.();
}
export function startEquityV71Shadow() {
  if (runtime.running) return;
  runtime.running = true;
  runtime.lastDecision = 'V71 SHADOW starting';
  setTimeout(tick, 1500).unref?.();
}
function status() {
  return { ...runtime, timer: undefined, busy: undefined, mode: 'paper-shadow', strategyVersion: 'V71', config: config(), ...persisted() };
}
router.get('/status', (req, res) => res.json(status()));
router.post('/start', (req, res) => {
  if (!hasCredentials(MODE)) return res.status(409).json({ error: 'No Alpaca paper credentials configured' });
  startEquityV71Shadow();
  return res.json(status());
});
router.post('/stop', (req, res) => {
  if (runtime.timer) clearTimeout(runtime.timer);
  runtime.timer = null;
  runtime.running = false;
  runtime.lastDecision = 'V71 SHADOW stopped';
  return res.json(status());
});

export default router;
