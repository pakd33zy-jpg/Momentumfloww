import express from 'express';
import { store } from './store.js';
import {
  getAccount, getMarketClock, getPositions, getStockBars, getStockSnapshots,
  getTradableAssets, hasCredentials, placeOrder, waitForFill, cancelOrder, getOrder,
} from './alpacaClient.js';
import { EQUITY_V50_DEFAULTS, evaluateEquityBasketV50, settleV50ShadowObservation } from './equityStrategyV50.js';

const router = express.Router();
const MODE = 'paper';
const STORE_KEY = 'v50PaperState';
const runtime = { running: false, timer: null, lastTickAt: null, lastDecision: 'V50 paper stopped', lastError: null };

function persisted() {
  return store.getConfig(STORE_KEY, {
    expertHistory: { momentum: [], reversion: [] },
    activePair: null,
    shadowObservation: null,
    closedPairs: [],
  });
}
function save(patch) {
  const next = { ...persisted(), ...patch, updatedAt: new Date().toISOString() };
  store.setConfig(STORE_KEY, next);
  return next;
}
function config() {
  return { ...EQUITY_V50_DEFAULTS, pairGrossFraction: 0.20, pollSeconds: 30, ...store.getConfig('v50PaperConfig', {}) };
}
function schedule() {
  if (!runtime.running) return;
  runtime.timer = setTimeout(tick, Math.max(10000, Number(config().pollSeconds) * 1000));
}
async function settle(orderId, timeoutMs = 15000) {
  let order = await waitForFill(MODE, orderId, { timeoutMs, intervalMs: 750 });
  if (!['filled', 'canceled', 'expired', 'rejected'].includes(order.status)) {
    try { await cancelOrder(MODE, orderId); } catch {}
    order = await waitForFill(MODE, orderId, { timeoutMs: 5000, intervalMs: 500 });
  }
  return getOrder(MODE, orderId);
}
async function latestPrices(symbols) {
  const snapshots = await getStockSnapshots(MODE, symbols, { feed: 'iex' });
  return Object.fromEntries(symbols.map((symbol) => {
    const s = snapshots[symbol] || {};
    return [symbol, Number(s.latestTrade?.p ?? s.minuteBar?.c ?? s.dailyBar?.c ?? 0)];
  }));
}
async function closeFilledLeg(leg, reason) {
  const side = leg.direction === 'LONG' ? 'sell' : 'buy';
  const order = await placeOrder({ mode: MODE, symbol: leg.symbol, qty: String(leg.qty), side, type: 'market', timeInForce: 'day' });
  const fill = await settle(order.id);
  if (!(Number(fill.filled_qty) > 0)) throw new Error(`V50 close failed for ${leg.symbol}: ${fill.status}`);
  return { ...leg, exitPrice: Number(fill.filled_avg_price), exitOrderId: fill.id, exitReason: reason };
}
async function rollback(legs, reason) {
  const results = [];
  for (const leg of legs) {
    try { results.push(await closeFilledLeg(leg, reason)); }
    catch (error) { results.push({ ...leg, rollbackError: error.message }); }
  }
  return results;
}
async function enterPair(signal) {
  const account = await getAccount(MODE);
  const equity = Number(account.equity || account.portfolio_value || 0);
  const gross = Math.min(equity * config().pairGrossFraction, Number(account.buying_power || 0) * 0.5);
  if (!(gross > 100)) throw new Error('V50 paper account has insufficient pair buying power');
  const budget = gross / 2;
  const opened = [];
  try {
    for (const leg of signal.legs) {
      const order = await placeOrder({
        mode: MODE, symbol: leg.symbol, notional: leg.direction === 'LONG' ? Number(budget.toFixed(2)) : undefined,
        qty: leg.direction === 'SHORT' ? String(Math.max(1, Math.floor(budget / leg.price))) : undefined,
        side: leg.direction === 'LONG' ? 'buy' : 'sell', type: 'market', timeInForce: 'day',
      });
      const fill = await settle(order.id);
      if (!(Number(fill.filled_qty) > 0) || !(Number(fill.filled_avg_price) > 0)) throw new Error(`${leg.symbol} entry ${fill.status}`);
      opened.push({ ...leg, qty: Number(fill.filled_qty), entryPrice: Number(fill.filled_avg_price), entryOrderId: fill.id });
    }
  } catch (error) {
    const rollbackResults = await rollback(opened, 'V50 paired-entry rollback');
    save({ lastRollback: { at: new Date().toISOString(), error: error.message, legs: rollbackResults } });
    throw new Error(`V50 pair aborted and rollback attempted: ${error.message}`);
  }
  const pair = { id: `v50-${Date.now()}`, playbook: signal.playbook, openedAt: new Date().toISOString(), closeAfter: new Date(Date.now() + config().holdMinutes * 60000).toISOString(), legs: opened, diagnostics: signal.diagnostics };
  save({ activePair: pair });
  runtime.lastDecision = `V50 PAPER entered ${signal.playbook}: LONG ${opened[0].symbol} / SHORT ${opened[1].symbol}`;
}
async function managePair(state) {
  const pair = state.activePair;
  if (!pair || Date.now() < new Date(pair.closeAfter).getTime()) return;
  const closed = [];
  const errors = [];
  for (const leg of pair.legs) {
    try { closed.push(await closeFilledLeg(leg, 'V50 max hold')); }
    catch (error) { errors.push({ symbol: leg.symbol, error: error.message }); }
  }
  if (errors.length) {
    save({ activePair: { ...pair, legs: pair.legs.filter((x) => !closed.some((y) => y.symbol === x.symbol)), closeErrors: errors } });
    throw new Error(`V50 incomplete pair exit: ${errors.map((x) => x.symbol).join(', ')}`);
  }
  const pnl = closed.reduce((sum, leg) => sum + (leg.direction === 'LONG' ? leg.exitPrice - leg.entryPrice : leg.entryPrice - leg.exitPrice) * leg.qty, 0);
  save({ activePair: null, closedPairs: [...(state.closedPairs || []), { ...pair, legs: closed, pnl, closedAt: new Date().toISOString() }].slice(-500) });
  runtime.lastDecision = `V50 PAPER closed pair; P&L $${pnl.toFixed(2)}`;
}
async function manageShadow(state) {
  const obs = state.shadowObservation;
  if (!obs || Date.now() < new Date(obs.closeAfter).getTime()) return state;
  const prices = await latestPrices([obs.highSymbol, obs.lowSymbol]);
  const result = settleV50ShadowObservation({ highEntry: obs.highEntry, highExit: prices[obs.highSymbol], lowEntry: obs.lowEntry, lowExit: prices[obs.lowSymbol] }, config());
  const history = {
    momentum: [...(state.expertHistory?.momentum || []), result.momentum].slice(-100),
    reversion: [...(state.expertHistory?.reversion || []), result.reversion].slice(-100),
  };
  return save({ expertHistory: history, shadowObservation: null });
}
async function scan(state) {
  const symbols = config().symbols;
  const [assets, barsBySymbol] = await Promise.all([
    getTradableAssets(MODE),
    getStockBars(MODE, symbols, { timeframe: '5Min', start: new Date(Date.now() - 5 * 24 * 3600000), end: new Date(), limit: 10000, feed: 'iex' }),
  ]);
  const assetsBySymbol = Object.fromEntries((assets.equities || []).filter((x) => symbols.includes(x.symbol)).map((x) => [x.symbol, x]));
  const result = evaluateEquityBasketV50({ barsBySymbol, assetsBySymbol, expertHistory: state.expertHistory, config: config() });
  const d = result.signal?.diagnostics || result.diagnostics;
  if (!state.shadowObservation && d?.strongest && d?.weakest) {
    save({ shadowObservation: {
      openedAt: new Date().toISOString(), closeAfter: new Date(Date.now() + config().holdMinutes * 60000).toISOString(),
      highSymbol: d.strongest.symbol, highEntry: d.strongest.price, lowSymbol: d.weakest.symbol, lowEntry: d.weakest.price,
    } });
  }
  return result;
}
async function tick() {
  if (!runtime.running) return;
  try {
    runtime.lastTickAt = new Date().toISOString(); runtime.lastError = null;
    if (!hasCredentials(MODE)) throw new Error('No Alpaca paper credentials configured');
    const clock = await getMarketClock(MODE);
    if (!clock?.is_open) { runtime.lastDecision = 'V50 PAPER waiting for market open'; return; }
    let state = persisted();
    await managePair(state); state = persisted();
    state = await manageShadow(state);
    if (!state.activePair) {
      const positions = await getPositions(MODE);
      const owned = new Set(positions.filter((p) => Math.abs(Number(p.qty || 0)) > 0).map((p) => p.symbol));
      if (config().symbols.some((s) => owned.has(s))) runtime.lastDecision = 'V50 PAPER waiting: ETF position already open';
      else {
        const result = await scan(state);
        if (result.signal) await enterPair(result.signal);
        else runtime.lastDecision = result.reason;
      }
    }
  } catch (error) {
    runtime.lastError = error.message; runtime.lastDecision = `V50 error: ${error.message}`; console.error('[v50-paper]', error);
  } finally { schedule(); }
}
function status() {
  const state = persisted();
  return { ...runtime, timer: undefined, mode: MODE, strategyVersion: 'V50', config: config(), ...state };
}
router.get('/status', (req, res) => res.json(status()));
router.post('/start', async (req, res) => {
  if (!hasCredentials(MODE)) return res.status(409).json({ error: 'No Alpaca paper credentials configured' });
  if (!runtime.running) { runtime.running = true; runtime.lastDecision = 'V50 PAPER starting'; await tick(); }
  return res.json(status());
});
router.post('/stop', (req, res) => {
  if (runtime.timer) clearTimeout(runtime.timer);
  runtime.timer = null; runtime.running = false; runtime.lastDecision = 'V50 PAPER stopped';
  return res.json(status());
});
export default router;
