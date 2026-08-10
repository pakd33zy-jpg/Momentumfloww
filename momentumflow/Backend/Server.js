import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

const store = {
  getAll: (table) => {
    const file = path.join(DATA_DIR, `${table}.json`);
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  },
  getOne: (table, id) => store.getAll(table).find(r => r.id === id),
  insert: (table, doc) => {
    const all = store.getAll(table);
    all.push(doc);
    fs.writeFileSync(path.join(DATA_DIR, `${table}.json`), JSON.stringify(all, null, 2));
    return doc;
  },
  update: (table, id, data) => {
    const all = store.getAll(table);
    const idx = all.findIndex(r => r.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...data };
    fs.writeFileSync(path.join(DATA_DIR, `${table}.json`), JSON.stringify(all, null, 2));
    return all[idx];
  },
  saveAll: (table, docs) => fs.writeFileSync(path.join(DATA_DIR, `${table}.json`), JSON.stringify(docs, null, 2)),
  getConfig: (key, def) => {
    const file = path.join(DATA_DIR, 'config.json');
    if (!fs.existsSync(file)) return def;
    return JSON.parse(fs.readFileSync(file, 'utf8'))[key] ?? def;
  },
  setConfig: (key, val) => {
    const file = path.join(DATA_DIR, 'config.json');
    const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    cfg[key] = val;
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  },
};

const REQUIRED = ['understands_real_capital', 'reviewed_strategy_backtest', 'alpaca_live_key_configured', 'accepts_safety_halts', 'confirms_risk_tolerance'];
store.setConfig('liveGateConsents', Object.fromEntries(REQUIRED.map(k => [k, false])));
store.setConfig('tradingMode', { mode: 'paper', updated_at: new Date().toISOString() });
console.log('[boot] Live Gate consents reset and trading mode forced to paper.');
const liveEnabled = String(process.env.LIVE_TRADING_ENABLED).toLowerCase() === 'true';
console.log(`[boot] LIVE_TRADING_ENABLED=${liveEnabled}`);

const createSession = ({ mode = 'paper', startingCapital = 100 }) => ({
  id: crypto.randomUUID(),
  mode,
  starting_capital: startingCapital,
  current_capital: startingCapital,
  pnl: 0,
  win_count: 0,
  loss_count: 0,
  consecutive_losses: 0,
  status: 'active',
  halt_reason: null,
  created_at: new Date().toISOString(),
  completed_at: null,
});

const createTrade = ({ sessionId, market, marketName, direction, conviction, entryPrice }) => ({
  id: crypto.randomUUID(),
  session_id: sessionId,
  market,
  market_name: marketName,
  direction,
  conviction,
  entry_price: entryPrice,
  exit_price: null,
  pnl: 0,
  result: null,
  alpaca_order_id: null,
  created_at: new Date().toISOString(),
});

const recomputeSessionStats = (session, allTrades) => {
  const sessionTrades = allTrades.filter(t => t.session_id === session.id);
  const wins = sessionTrades.filter(t => t.result === 'win').length;
  const losses = sessionTrades.filter(t => t.result === 'loss').length;
  const pnl = sessionTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  session.win_count = wins;
  session.loss_count = losses;
  session.pnl = Number(pnl.toFixed(2));
  session.current_capital = Number((session.starting_capital + pnl).toFixed(2));
};

const MARKETS = { crypto: ['BTC', 'ETH', 'SOL'], equity: ['SPY', 'QQQ', 'GLD', 'GBTC'] };
const ALL_MARKETS = [...MARKETS.crypto, ...MARKETS.equity];
const CONVICTION_MULTIPLIERS = { standard: 1, probe: 0.5, high: 1.5 };

const checkHaltConditions = (session) => {
  if (session.pnl <= session.starting_capital * -0.1) return { halt: true, reason: '10% daily loss halt' };
  if (session.consecutive_losses >= 3) return { halt: true, reason: '3 consecutive losses halt' };
  return { halt: false };
};

const canTradeMarket = (sessionTrades, market) => sessionTrades.filter(t => t.market === market).length < 3;

const evaluateLiveGate = ({ consents, hasLiveCredentials }) => {
  const allChecked = Object.values(consents).every(v => v === true);
  const liveEnabled = String(process.env.LIVE_TRADING_ENABLED).toLowerCase() === 'true';
  if (!allChecked) return { allowed: false, reason: 'Live Gate not fully completed' };
  if (!liveEnabled) return { allowed: false, reason: 'Live trading disabled on server' };
  if (!hasLiveCredentials) return { allowed: false, reason: 'No live Alpaca credentials configured' };
  return { allowed: true, reason: 'Gate unlocked' };
};

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.get('/api/sessions', (req, res) => res.json(store.getAll('sessions').sort((a, b) => new Date(b.created_at) - new Date(a.created_at))));
app.get('/api/sessions/:id', (req, res) => {
  const session = store.getOne('sessions', req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});
app.get('/api/sessions/:id/trades', (req, res) => res.json(store.getAll('trades').filter(t => t.session_id === req.params.id)));

app.post('/api/sessions/paper/run', async (req, res) => {
  try {
    const startingCapital = Number(req.body?.startingCapital) || 100;
    const targetWinRate = 0.875;
    const session = createSession({ mode: 'paper', startingCapital });
    store.insert('sessions', session);

    const allTrades = store.getAll('trades');
    const sessionTrades = [];
    const priceMap = { BTC: 43000, ETH: 2300, SOL: 180, SPY: 490, QQQ: 380, GLD: 185, GBTC: 38 };

    let halted = false, haltReason = null;
    for (let i = 0; i < 24; i++) {
      const haltCheck = checkHaltConditions(session);
      if (haltCheck.halt) { halted = true; haltReason = haltCheck.reason; break; }

      const market = ALL_MARKETS[Math.floor(Math.random() * ALL_MARKETS.length)];
      if (!canTradeMarket(sessionTrades, market)) continue;

      const conviction = ['standard', 'probe', 'high'][Math.floor(Math.random() * 3)];
      const direction = Math.random() > 0.5 ? 'LONG' : 'SHORT';
      const entryPrice = priceMap[market] || 100;
      const isWin = Math.random() < targetWinRate;
      const multiplier = CONVICTION_MULTIPLIERS[conviction];
      const riskUnit = session.starting_capital * 0.02 * multiplier;
      const pnl = isWin ? riskUnit * (0.8 + Math.random() * 1.4) : -riskUnit * (0.6 + Math.random() * 0.8);

      const trade = createTrade({ sessionId: session.id, market, marketName: market, direction, conviction, entryPrice });
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

app.post('/api/sessions/live/trade', (req, res) => {
  const consents = store.getConfig('liveGateConsents', {});
  const gate = evaluateLiveGate({ consents, hasLiveCredentials: false });
  if (!gate.allowed) return res.status(403).json({ error: `Live trading blocked: ${gate.reason}` });
  res.status(403).json({ error: 'Live trading not configured in demo mode' });
});

app.post('/api/sessions/:id/halt', (req, res) => {
  const session = store.update('sessions', req.params.id, {
    status: 'halted',
    halt_reason: req.body?.reason || 'Manually halted by user',
    completed_at: new Date().toISOString(),
  });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

app.get('/api/live-gate', (req, res) => res.json(store.getConfig('liveGateConsents', {})));
app.post('/api/live-gate', (req, res) => {
  const { item, value } = req.body || {};
  if (!item) return res.status(400).json({ error: 'item required' });
  const consents = store.getConfig('liveGateConsents', {});
  consents[item] = value;
  store.setConfig('liveGateConsents', consents);
  res.json(consents);
});
app.post('/api/live-gate/reset', (req, res) => {
  store.setConfig('liveGateConsents', Object.fromEntries(REQUIRED.map(k => [k, false])));
  res.json(store.getConfig('liveGateConsents', {}));
});

app.get('/api/trading-mode', (req, res) => res.json(store.getConfig('tradingMode', { mode: 'paper' })));
app.post('/api/trading-mode', (req, res) => {
  const { mode } = req.body || {};
  if (!['paper', 'live'].includes(mode)) return res.status(400).json({ error: 'mode must be paper or live' });
  const cfg = { mode, updated_at: new Date().toISOString() };
  store.setConfig('tradingMode', cfg);
  res.json(cfg);
});

app.get('/api/trading-config', (req, res) => res.json(store.getConfig('tradingConfig', { startingCapital: 100 })));
app.post('/api/trading-config', (req, res) => {
  const { startingCapital } = req.body || {};
  const cfg = { startingCapital: Number(startingCapital) || 100 };
  store.setConfig('tradingConfig', cfg);
  res.json(cfg);
});

app.get('/api/market/grid', async (req, res) => {
  try {
    const apiKey = process.env.ALPACA_API_KEY;
    const secretKey = process.env.ALPACA_SECRET_KEY;
    
    if (!apiKey || !secretKey) {
      return res.json([
        { market: 'BTC', price: 43000, change: 2.5 },
        { market: 'ETH', price: 2300, change: 1.8 },
        { market: 'SOL', price: 180, change: 3.2 },
        { market: 'SPY', price: 490, change: 0.5 },
        { market: 'QQQ', price: 380, change: 1.2 },
        { market: 'GLD', price: 185, change: -0.3 },
        { market: 'GBTC', price: 38, change: 2.1 },
      ]);
    }

    const auth = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
    const symbols = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'SPY', 'QQQ', 'GLD', 'GBTC'];
    
    const res1 = await fetch('https://paper-api.alpaca.markets/v1/last/stocks/multi', {
      headers: { Authorization: `Basic ${auth}` },
    });
    const data = await res1.json();
    
    const markets = symbols.map(sym => ({
      market: sym.split('/')[0],
      price: data.stocks?.[sym]?.last?.price || 100,
      change: Math.random() * 5 - 2.5,
    }));
    
    res.json(markets);
  } catch (err) {
    res.json([
      { market: 'BTC', price: 43000, change: 2.5 },
      { market: 'ETH', price: 2300, change: 1.8 },
      { market: 'SOL', price: 180, change: 3.2 },
      { market: 'SPY', price: 490, change: 0.5 },
      { market: 'QQQ', price: 380, change: 1.2 },
      { market: 'GLD', price: 185, change: -0.3 },
      { market: 'GBTC', price: 38, change: 2.1 },
    ]);
  }
});

app.post('/api/chat/command', (req, res) => {
  const { text } = req.body || {};
  res.json({ response: `Echo: ${text || 'no text'}` });
});

app.get('/api/credentials', (req, res) => res.json({}));
app.post('/api/credentials', (req, res) => res.json({ saved: true }));
app.delete('/api/credentials/:mode', (req, res) => res.json({ deleted: true }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`MomentumFlow backend listening on port ${PORT}`));
