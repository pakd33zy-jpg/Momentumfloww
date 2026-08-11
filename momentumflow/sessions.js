import express from 'express';
import { store } from './store.js';
import { createSession, createTrade, recomputeSessionStats, MARKETS, CONVICTION_MULTIPLIERS } from './models.js';
import { checkHaltConditions, canTradeMarket, evaluateLiveGate } from './safetyEngine.js';
import { getMarketGrid, getSpotPrice, placeOrder, hasCredentials } from './alpacaClient.js';

const router = express.Router();

const MARKET_NAMES = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana',
  SPY: 'S&P 500 ETF', QQQ: 'Nasdaq 100 ETF', GLD: 'Gold ETF', GBTC: 'Grayscale Bitcoin Trust',
};

const ALL_MARKETS = [...MARKETS.crypto, ...MARKETS.equity];

function pickConviction() {
  const roll = Math.random();
  if (roll < 0.5) return 'standard';
  if (roll < 0.8) return 'probe';
  return 'high';
}

// --- Listing ---

router.get('/', (req, res) => {
  res.json(store.getAll('sessions').sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

router.get('/:id', (req, res) => {
  const session = store.getOne('sessions', req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

router.get('/:id/trades', (req, res) => {
  const trades = store.getAll('trades').filter((t) => t.session_id === req.params.id);
  res.json(trades);
});

// --- PAPER: runs a full simulated session synchronously and returns the result ---
// This never touches Alpaca and risks no capital. It's the default and the only
// mode available until the live gate is fully unlocked.
router.post('/paper/run', async (req, res) => {
  try {
    const config = store.getConfig('tradingConfig', { startingCapital: 100 });
    const startingCapital = Number(req.body?.startingCapital) || config.startingCapital;
    const targetWinRate = 0.875; // ~87.5% target per spec; simulation only, not a promise of real returns

    const session = createSession({ mode: 'paper', startingCapital });
    store.insert('sessions', session);

    const allTrades = store.getAll('trades');
    const sessionTrades = [];
    const prices = await getMarketGrid(ALL_MARKETS);
    const priceMap = Object.fromEntries(prices.map((p) => [p.market, p.price]));

    let halted = false;
    let haltReason = null;

    for (let i = 0; i < 24; i++) {
      const haltCheck = checkHaltConditions(session);
      if (haltCheck.halt) { halted = true; haltReason = haltCheck.reason; break; }

      const market = ALL_MARKETS[Math.floor(Math.random() * ALL_MARKETS.length)];
      if (!canTradeMarket(sessionTrades, market)) continue;

      const conviction = pickConviction();
      const direction = Math.random() > 0.5 ? 'LONG' : 'SHORT';
      const entryPrice = priceMap[market] ?? 100;
      const isWin = Math.random() < targetWinRate;
      const multiplier = CONVICTION_MULTIPLIERS[conviction];
      const riskUnit = session.starting_capital * 0.02 * multiplier; // simulated risk sizing
      const pnl = isWin ? riskUnit * (0.8 + Math.random() * 1.4) : -riskUnit * (0.6 + Math.random() * 0.8);

      const trade = createTrade({ sessionId: session.id, market, marketName: MARKET_NAMES[market], direction, conviction, entryPrice });
      trade.exit_price = Number((entryPrice * (1 + (isWin ? 1 : -1) * 0.01 * multiplier)).toFixed(2));
      trade.pnl = Number(pnl.toFixed(2));
      trade.result = isWin ? 'win' : 'loss';

      sessionTrades.push(trade);
      allTrades.push(trade);

      session.consecutive_losses = isWin ? 0 : session.consecutive_losses + 1;
      recomputeSessionStats(session, allTrades);
    }

    store.saveAll('trades', allTrades);
    session.status = halted ? 'halted' : 'completed';
    session.halt_reason = haltReason;
    session.completed_at = new Date().toISOString();
    store.update('sessions', session.id, session);

    res.json({ session, trades: sessionTrades });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- LIVE: places ONE real order per call, behind the full hard gate ---
// Deliberately not an autonomous loop: every live trade requires a fresh request,
// so a human (or an explicit, deliberate automation the user builds on top of this)
// is in the loop for every real-money order, not just at session start.
router.post('/live/trade', async (req, res) => {
  try {
    const { sessionId, market, direction, conviction = 'standard', qty } = req.body || {};

    if (!ALL_MARKETS.includes(market)) {
      return res.status(400).json({ error: `Unknown market ${market}` });
    }
    if (!['LONG', 'SHORT'].includes(direction)) {
      return res.status(400).json({ error: "direction must be 'LONG' or 'SHORT'" });
    }
    if (!qty || Number(qty) <= 0) {
      return res.status(400).json({ error: 'qty must be a positive number' });
    }

    const consents = store.getConfig('liveGateConsents', {});
    const gate = evaluateLiveGate({ consents, hasLiveCredentials: hasCredentials('live') });
    if (!gate.allowed) {
      return res.status(403).json({ error: `Live trading blocked: ${gate.reason}` });
    }

    let session = sessionId ? store.getOne('sessions', sessionId) : null;
    if (!session) {
      session = createSession({ mode: 'live', startingCapital: Number(req.body?.startingCapital) || 100 });
      store.insert('sessions', session);
    }
    if (session.mode !== 'live') {
      return res.status(400).json({ error: 'sessionId refers to a non-live session' });
    }

    const haltCheck = checkHaltConditions(session);
    if (haltCheck.halt) {
      return res.status(403).json({ error: `Session is halted: ${haltCheck.reason}`, session });
    }
    const allTrades = store.getAll('trades');
    const sessionTrades = allTrades.filter((t) => t.session_id === session.id);
    if (!canTradeMarket(sessionTrades, market)) {
      return res.status(403).json({ error: `Per-market trade cap reached for ${market}` });
    }

    const { price: entryPrice } = await getSpotPrice(market);
    const side = direction === 'LONG' ? 'buy' : 'sell';
    const alpacaSymbol = market === 'BTC' || market === 'ETH' || market === 'SOL' ? `${market}/USD` : market;

    // Real order placement against Alpaca's live endpoint.
    const order = await placeOrder({ mode: 'live', symbol: alpacaSymbol, qty, side });

    const trade = createTrade({ sessionId: session.id, market, marketName: MARKET_NAMES[market], direction, conviction, entryPrice });
    trade.result = null; // live orders are opened, not scored until closed — see /live/close
    trade.alpaca_order_id = order.id;
    allTrades.push(trade);
    store.saveAll('trades', allTrades);

    recomputeSessionStats(session, allTrades);
    store.update('sessions', session.id, session);

    res.json({ session, trade, alpaca_order: order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/halt', (req, res) => {
  const session = store.update('sessions', req.params.id, {
    status: 'halted',
    halt_reason: req.body?.reason || 'Manually halted by user',
    completed_at: new Date().toISOString(),
  });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

export default router;
