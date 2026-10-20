import express from 'express';
import { randomUUID } from 'node:crypto';
import { store } from './store.js';

const router = express.Router();
const STATE_KEY = 'kalshiPaperState';
const STARTING_BALANCE = Number(process.env.KALSHI_PAPER_STARTING_BALANCE || 10000);
const MAX_POSITION_FRACTION = 0.05;
const MARKET_API = 'https://api.elections.kalshi.com/trade-api/v2';

function state() {
  return store.getConfig(STATE_KEY, {
    mode: 'paper',
    startingBalance: STARTING_BALANCE,
    cash: STARTING_BALANCE,
    positions: [],
    orders: [],
    realizedPnl: 0,
    createdAt: new Date().toISOString(),
  });
}
function save(s) { store.setConfig(STATE_KEY, s); return s; }
function dollars(cents) { return Number(cents) / 100; }
function feeEstimate(priceCents, count) {
  // Conservative estimate based on the commonly published 7% probability-based
  // fee formula. Exact fees vary by contract/product; this is not an exchange quote.
  const p = dollars(priceCents);
  return Math.ceil((0.07 * count * p * (1 - p)) * 100) / 100;
}
function cleanMarket(m) {
  return {
    ticker: m.ticker,
    event_ticker: m.event_ticker,
    title: m.title,
    subtitle: m.subtitle || '',
    status: m.status,
    close_time: m.close_time,
    expiration_time: m.expiration_time,
    yes_bid: m.yes_bid ?? null,
    yes_ask: m.yes_ask ?? null,
    no_bid: m.no_bid ?? null,
    no_ask: m.no_ask ?? null,
    volume: m.volume ?? null,
    open_interest: m.open_interest ?? null,
    result: m.result || null,
  };
}
async function fetchMarkets({ limit = 100, cursor } = {}) {
  const url = new URL(MARKET_API + '/markets');
  url.searchParams.set('status', 'open');
  url.searchParams.set('limit', String(Math.min(Math.max(Number(limit) || 100, 1), 200)));
  if (cursor) url.searchParams.set('cursor', String(cursor));
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('Kalshi market feed returned HTTP ' + response.status);
  const data = await response.json();
  return { markets: (data.markets || []).map(cleanMarket), cursor: data.cursor || null };
}

router.get('/status', (_req, res) => {
  const s = state();
  const openPositions = s.positions.filter(p => p.status === 'open');
  const reserved = openPositions.reduce((sum, p) => sum + p.costBasis, 0);
  res.json({
    mode: 'paper-only',
    liveTradingEnabled: false,
    startingBalance: s.startingBalance,
    cash: Number(s.cash.toFixed(2)),
    reservedCapital: Number(reserved.toFixed(2)),
    openPositions: openPositions.length,
    totalOrders: s.orders.length,
    realizedPnl: Number(s.realizedPnl.toFixed(2)),
    updatedAt: s.updatedAt || null,
  });
});

router.get('/markets', async (req, res) => {
  try {
    const data = await fetchMarkets({ limit: req.query.limit, cursor: req.query.cursor });
    res.json({ source: 'Kalshi public market API', mode: 'read-only', ...data });
  } catch (error) {
    res.status(502).json({ error: 'Unable to load Kalshi markets', detail: error.message });
  }
});

router.get('/positions', async (req, res) => {
  const s = state();
  const open = s.positions.filter(p => p.status === 'open');
  let marketMap = new Map();
  try {
    const data = await fetchMarkets({ limit: 200 });
    marketMap = new Map(data.markets.map(m => [m.ticker, m]));
  } catch { /* position history remains available even if the public feed is down */ }
  const positions = open.map(p => {
    const m = marketMap.get(p.ticker);
    const bid = m ? (p.side === 'yes' ? m.yes_bid : m.no_bid) : null;
    const mark = Number.isFinite(Number(bid)) ? dollars(bid) : null;
    const marketValue = mark === null ? null : mark * p.contracts;
    return { ...p, markCents: bid ?? null, marketValue: marketValue === null ? null : Number(marketValue.toFixed(2)),
      unrealizedPnl: marketValue === null ? null : Number((marketValue - p.costBasis - p.fees).toFixed(2)) };
  });
  res.json({ mode: 'paper-only', positions });
});

router.get('/orders', (_req, res) => {
  const s = state();
  res.json({ mode: 'paper-only', orders: s.orders.slice(-200).reverse() });
});

// Simulated buy only. No endpoint in this router submits an order to Kalshi.
router.post('/orders', async (req, res) => {
  const { ticker, side, contracts, priceCents } = req.body || {};
  if (typeof ticker !== 'string' || !ticker.trim()) return res.status(400).json({ error: 'ticker is required' });
  if (!['yes', 'no'].includes(side)) return res.status(400).json({ error: 'side must be yes or no' });
  const count = Number(contracts);
  const price = Number(priceCents);
  if (!Number.isInteger(count) || count < 1 || count > 1000) return res.status(400).json({ error: 'contracts must be an integer from 1 to 1000' });
  if (!Number.isInteger(price) || price < 1 || price > 99) return res.status(400).json({ error: 'priceCents must be an integer from 1 to 99' });

  let market;
  try {
    const data = await fetchMarkets({ limit: 200 });
    market = data.markets.find(m => m.ticker === ticker);
    if (!market) return res.status(404).json({ error: 'Ticker not found in currently open markets' });
  } catch (error) {
    return res.status(502).json({ error: 'Cannot validate ticker against Kalshi market feed', detail: error.message });
  }

  const s = state();
  const costBasis = dollars(price) * count;
  const fees = feeEstimate(price, count);
  const totalCost = Number((costBasis + fees).toFixed(2));
  const openExposure = s.positions.filter(p => p.status === 'open').reduce((sum, p) => sum + p.costBasis + p.fees, 0);
  const cap = s.startingBalance * MAX_POSITION_FRACTION;
  if (totalCost > s.cash) return res.status(400).json({ error: 'Insufficient paper cash', required: totalCost, cash: s.cash });
  if (totalCost + openExposure > s.startingBalance) return res.status(400).json({ error: 'Paper exposure cap reached' });
  if (totalCost > cap) return res.status(400).json({ error: 'Position exceeds 5% of starting paper balance', maxPositionCost: cap });

  const now = new Date().toISOString();
  const position = {
    id: randomUUID(), ticker, title: market.title, side, contracts: count,
    entryPriceCents: price, costBasis: Number(costBasis.toFixed(2)), fees,
    status: 'open', openedAt: now,
  };
  const order = { id: randomUUID(), ticker, side, contracts: count, priceCents: price,
    estimatedFees: fees, status: 'paper-filled', createdAt: now, positionId: position.id };
  s.cash = Number((s.cash - totalCost).toFixed(2));
  s.positions.push(position);
  s.orders.push(order);
  s.updatedAt = now;
  save(s);
  res.status(201).json({ mode: 'paper-only', order, position, cash: s.cash,
    note: 'Simulated fill at the user-specified price; not an exchange execution.' });
});

router.post('/positions/:id/settle', (req, res) => {
  const { result } = req.body || {};
  if (!['yes', 'no'].includes(result)) return res.status(400).json({ error: 'result must be yes or no' });
  const s = state();
  const p = s.positions.find(x => x.id === req.params.id && x.status === 'open');
  if (!p) return res.status(404).json({ error: 'Open paper position not found' });
  const payout = p.side === result ? p.contracts : 0;
  const pnl = Number((payout - p.costBasis - p.fees).toFixed(2));
  s.cash = Number((s.cash + payout).toFixed(2));
  s.realizedPnl = Number((s.realizedPnl + pnl).toFixed(2));
  p.status = 'settled';
  p.result = result;
  p.payout = payout;
  p.realizedPnl = pnl;
  p.settledAt = new Date().toISOString();
  s.updatedAt = p.settledAt;
  save(s);
  res.json({ mode: 'paper-only', position: p, cash: s.cash, realizedPnl: s.realizedPnl });
});

export default router;
