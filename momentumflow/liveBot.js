import express from 'express';
import { store } from './store.js';
import { createSession, createTrade, recomputeSessionStats } from './models.js';
import { checkHaltConditions, evaluateLiveGate, canTradeMarket } from './safetyEngine.js';
import { getAccount, getPositions, getSpotPrice, hasCredentials, placeOrder, waitForFill } from './alpacaClient.js';

const router = express.Router();
const CRYPTO = ['BTC', 'ETH', 'SOL'];
const MARKET_NAMES = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana' };
const state = {
  running: false,
  timer: null,
  sessionId: null,
  startedAt: null,
  lastTickAt: null,
  lastError: null,
  priceHistory: Object.fromEntries(CRYPTO.map((m) => [m, []])),
  openTradeId: null,
  lastDecision: 'stopped',
  signalSnapshot: {},
};

const DEFAULTS = {
  pollSeconds: 5,
  lookbackSamples: 4,
  entryMomentumPct: 0.15,
  takeProfitPct: 0.6,
  stopLossPct: 0.4,
  maxHoldMinutes: 15,
  maxNotionalPerTrade: 5,
};

function config() {
  return { ...DEFAULTS, ...store.getConfig('liveBotConfig', {}) };
}

function liveGate() {
  const consents = store.getConfig('liveGateConsents', {});
  return evaluateLiveGate({ consents, hasLiveCredentials: hasCredentials('live') });
}

function publicState() {
  return {
    running: state.running,
    sessionId: state.sessionId,
    startedAt: state.startedAt,
    lastTickAt: state.lastTickAt,
    lastError: state.lastError,
    openTradeId: state.openTradeId,
    lastDecision: state.lastDecision,
    signalSnapshot: state.signalSnapshot,
    config: config(),
  };
}

function alpacaSymbol(market) { return `${market}/USD`; }

function stopLoop(reason = null) {
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  state.running = false;
  if (reason) state.lastError = reason;
}

function scheduleNext() {
  if (!state.running) return;
  const delay = Math.max(2, Number(config().pollSeconds)) * 1000;
  state.timer = setTimeout(runTick, delay);
}

async function closeOpenTrade(trade, currentPrice, reason) {
  const qty = Number(trade.filled_qty || trade.qty);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Open trade has no filled quantity to close.');

  const order = await placeOrder({ mode: 'live', symbol: alpacaSymbol(trade.market), qty, side: 'sell', type: 'market', timeInForce: 'gtc' });
  const fill = await waitForFill('live', order.id);
  if (fill.status !== 'filled') throw new Error(`Exit order ${order.id} was not filled (status: ${fill.status}).`);

  const exitPrice = Number(fill.filled_avg_price || currentPrice);
  const entryPrice = Number(trade.entry_price);
  const pnl = (exitPrice - entryPrice) * Number(fill.filled_qty || qty);
  const result = pnl >= 0 ? 'win' : 'loss';

  const allTrades = store.getAll('trades');
  const idx = allTrades.findIndex((t) => t.id === trade.id);
  if (idx >= 0) {
    allTrades[idx] = {
      ...allTrades[idx],
      exit_price: exitPrice,
      pnl: Number(pnl.toFixed(4)),
      result,
      exit_reason: reason,
      exit_order_id: order.id,
      closed_at: new Date().toISOString(),
    };
    store.saveAll('trades', allTrades);
  }

  const session = store.getOne('sessions', trade.session_id);
  if (session) {
    session.consecutive_losses = result === 'loss' ? Number(session.consecutive_losses || 0) + 1 : 0;
    recomputeSessionStats(session, allTrades);
    store.update('sessions', session.id, session);
  }
  state.openTradeId = null;
}

async function maybeManageOpenTrade(prices) {
  if (!state.openTradeId) return false;
  state.lastDecision = 'managing open position';
  const trade = store.getOne('trades', state.openTradeId);
  if (!trade || trade.result !== null) { state.openTradeId = null; return false; }

  const price = prices[trade.market];
  const entry = Number(trade.entry_price);
  if (!Number.isFinite(price) || !Number.isFinite(entry) || entry <= 0) return true;
  const movePct = ((price - entry) / entry) * 100;
  const ageMinutes = (Date.now() - new Date(trade.timestamp || trade.created_at).getTime()) / 60000;
  const cfg = config();

  if (movePct >= cfg.takeProfitPct) await closeOpenTrade(trade, price, `take profit +${movePct.toFixed(3)}%`);
  else if (movePct <= -cfg.stopLossPct) await closeOpenTrade(trade, price, `stop loss ${movePct.toFixed(3)}%`);
  else if (ageMinutes >= cfg.maxHoldMinutes) await closeOpenTrade(trade, price, `max hold ${ageMinutes.toFixed(1)}m`);
  return true;
}

async function maybeEnter(prices) {
  const session = store.getOne('sessions', state.sessionId);
  if (!session) throw new Error('Live bot session was not found.');
  if (session.status !== 'running') {
    stopLoop(`Session is ${session.status}.`);
    return;
  }
  const allTrades = store.getAll('trades');
  const sessionTrades = allTrades.filter((t) => t.session_id === session.id);
  const halt = checkHaltConditions(session);
  if (halt.halt) {
    store.update('sessions', session.id, { status: 'halted', halt_reason: halt.reason, completed_at: new Date().toISOString() });
    stopLoop(`Safety halt: ${halt.reason}`);
    return;
  }

  const cfg = config();
  let best = null;
  const snapshot = {};
  for (const market of CRYPTO) {
    const history = state.priceHistory[market];
    const eligible = canTradeMarket(sessionTrades, market);
    if (history.length < cfg.lookbackSamples) {
      snapshot[market] = { samples: history.length, needed: cfg.lookbackSamples, eligible, momentumPct: null };
      continue;
    }
    const oldPrice = history[history.length - cfg.lookbackSamples].price;
    const currentPrice = prices[market];
    const momentumPct = ((currentPrice - oldPrice) / oldPrice) * 100;
    snapshot[market] = {
      samples: history.length,
      needed: cfg.lookbackSamples,
      eligible,
      momentumPct: Number(momentumPct.toFixed(4)),
      thresholdPct: cfg.entryMomentumPct,
    };
    if (eligible && momentumPct >= cfg.entryMomentumPct && (!best || momentumPct > best.momentumPct)) {
      best = { market, currentPrice, momentumPct };
    }
  }
  state.signalSnapshot = snapshot;
  if (!best) {
    const warming = Object.values(snapshot).some((x) => x.momentumPct === null);
    state.lastDecision = warming ? 'warming up price history' : 'scanning — waiting for momentum signal';
    return;
  }
  state.lastDecision = `entry signal ${best.market} +${best.momentumPct.toFixed(4)}%`;

  const account = await getAccount('live');
  const buyingPower = Number(account.buying_power || account.cash || 0);
  const notional = Math.min(Number(cfg.maxNotionalPerTrade), buyingPower);
  if (!Number.isFinite(notional) || notional < 1) throw new Error('Insufficient live buying power for the configured trade size.');

  const order = await placeOrder({ mode: 'live', symbol: alpacaSymbol(best.market), notional: Number(notional.toFixed(2)), side: 'buy', type: 'market', timeInForce: 'gtc' });
  const fill = await waitForFill('live', order.id);
  if (fill.status !== 'filled') throw new Error(`Entry order ${order.id} was not filled (status: ${fill.status}).`);

  const entryPrice = Number(fill.filled_avg_price || best.currentPrice);
  const trade = createTrade({ sessionId: session.id, market: best.market, marketName: MARKET_NAMES[best.market], direction: 'LONG', conviction: 'standard', entryPrice });
  trade.alpaca_order_id = order.id;
  trade.qty = Number(fill.filled_qty);
  trade.filled_qty = Number(fill.filled_qty);
  trade.entry_signal = { momentum_pct: Number(best.momentumPct.toFixed(4)), lookback_samples: cfg.lookbackSamples };
  store.insert('trades', trade);
  state.openTradeId = trade.id;
  state.lastDecision = `entered ${best.market} at ${entryPrice}`;
}

async function runTick() {
  if (!state.running) return;
  try {
    const gate = liveGate();
    if (!gate.allowed) { stopLoop(`Live Gate closed while bot was running: ${gate.reason}`); return; }
    const mode = store.getConfig('tradingMode', { mode: 'paper' });
    if (mode.mode !== 'live') { stopLoop('Trading mode changed away from live.'); return; }

    const prices = {};
    for (const market of CRYPTO) {
      const spot = await getSpotPrice(market);
      if (spot.source !== 'coinbase') throw new Error(`Refusing live automation: no verified live price for ${market}.`);
      prices[market] = spot.price;
      const h = state.priceHistory[market];
      h.push({ at: Date.now(), price: spot.price });
      while (h.length > 30) h.shift();
    }

    state.lastTickAt = new Date().toISOString();
    state.lastError = null;
    const hadOpen = await maybeManageOpenTrade(prices);
    if (!hadOpen && !state.openTradeId) await maybeEnter(prices);
  } catch (err) {
    console.error('[live-bot]', err);
    state.lastError = err.message;
    state.lastDecision = `stopped on error: ${err.message}`;
    stopLoop(err.message);
  } finally {
    scheduleNext();
  }
}

router.get('/status', (req, res) => res.json(publicState()));

router.post('/start', async (req, res) => {
  try {
    if (state.running) return res.status(409).json({ error: 'Live bot is already running.', ...publicState() });
    const gate = liveGate();
    if (!gate.allowed) return res.status(403).json({ error: `Live bot blocked: ${gate.reason}` });
    const mode = store.getConfig('tradingMode', { mode: 'paper' });
    if (mode.mode !== 'live') return res.status(403).json({ error: 'Switch Trading Mode to live before starting the live bot.' });

    const account = await getAccount('live');
    if (account.trading_blocked) return res.status(403).json({ error: 'Alpaca reports trading_blocked=true for this account.' });
    const positions = await getPositions('live');
    const botSymbols = new Set(CRYPTO.map(alpacaSymbol));
    const existingBotPosition = positions.find((p) => botSymbols.has(p.symbol) && Math.abs(Number(p.qty || 0)) > 0);
    if (existingBotPosition) {
      return res.status(409).json({ error: `Refusing to start while an existing ${existingBotPosition.symbol} position is open. Close/reconcile it first.` });
    }
    const unfinishedLocalTrade = store.getAll('trades').find((t) => t.result === null && CRYPTO.includes(t.market));
    if (unfinishedLocalTrade) {
      return res.status(409).json({ error: `Refusing to start while local trade ${unfinishedLocalTrade.id} is still marked open.` });
    }
    const equity = Number(account.equity || account.cash || 0);
    if (!Number.isFinite(equity) || equity <= 0) return res.status(403).json({ error: 'Live account has no available equity.' });

    const session = createSession({ mode: 'live', startingCapital: equity });
    store.insert('sessions', session);
    state.running = true;
    state.sessionId = session.id;
    state.startedAt = new Date().toISOString();
    state.lastTickAt = null;
    state.lastError = null;
    state.openTradeId = null;
    state.lastDecision = 'starting — collecting live prices';
    state.signalSnapshot = {};
    state.priceHistory = Object.fromEntries(CRYPTO.map((m) => [m, []]));
    setImmediate(runTick);
    res.json(publicState());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/stop', async (req, res) => {
  stopLoop();
  state.lastDecision = 'stopped by user';
  try {
    if (state.openTradeId) {
      const trade = store.getOne('trades', state.openTradeId);
      if (trade && trade.result === null) {
        const spot = await getSpotPrice(trade.market);
        if (spot.source !== 'coinbase') throw new Error(`Could not verify live ${trade.market} price while stopping.`);
        await closeOpenTrade(trade, spot.price, 'live bot stopped by user');
      }
    }
    if (state.sessionId) {
      const session = store.getOne('sessions', state.sessionId);
      if (session && session.status === 'running') {
        store.update('sessions', session.id, { status: 'halted', halt_reason: 'Live bot stopped by user', completed_at: new Date().toISOString() });
      }
    }
    res.json(publicState());
  } catch (err) {
    state.lastError = `Bot stopped, but open-position close failed: ${err.message}`;
    res.status(500).json({ error: state.lastError, ...publicState() });
  }
});

export default router;
