import express from 'express';
import fetch from 'node-fetch';
import { getCredentials, getAccount, getPositions } from './alpacaClient.js';

const router = express.Router();

const UNIVERSE = ['SPY', 'QQQ', 'IWM', 'DIA', 'XLK', 'XLF', 'XLE', 'GLD', 'TLT'];
const MOMENTUM_DAYS = 63;
const SMA_DAYS = 150;
const REBALANCE_EVERY = 5;
const WEIGHTS = [0.70, 0.30];
const DEFAULT_BUDGET = 100000;
const PAPER_BASE = 'https://paper-api.alpaca.markets';
const DATA_BASE = 'https://data.alpaca.markets';

function headers() {
  const creds = getCredentials('paper');
  if (!creds) throw new Error('No Alpaca paper credentials configured.');
  return {
    'APCA-API-KEY-ID': creds.keyId,
    'APCA-API-SECRET-KEY': creds.secretKey,
    'Content-Type': 'application/json',
  };
}

async function jsonRequest(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Alpaca request failed (${res.status})`);
  return data;
}

async function getClock() {
  return jsonRequest(`${PAPER_BASE}/v2/clock`);
}

async function getOrders() {
  const qs = new URLSearchParams({ status: 'all', limit: '500', direction: 'desc' });
  return jsonRequest(`${PAPER_BASE}/v2/orders?${qs.toString()}`);
}

async function getBars(symbol) {
  const end = new Date();
  const start = new Date(end.getTime() - 540 * 24 * 60 * 60 * 1000);
  const qs = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString(),
    timeframe: '1Day',
    feed: 'iex',
    adjustment: 'all',
    sort: 'asc',
    limit: '10000',
  });
  const payload = await jsonRequest(
    `${DATA_BASE}/v2/stocks/${encodeURIComponent(symbol)}/bars?${qs.toString()}`
  );
  return Array.isArray(payload?.bars) ? payload.bars : [];
}

function easternDate(timestamp) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp));
}

function prepareBars(rows, marketOpen, marketDate) {
  const out = rows
    .map((b) => ({
      session: easternDate(b.t),
      open: Number(b.o),
      high: Number(b.h),
      low: Number(b.l),
      close: Number(b.c),
      volume: Number(b.v),
    }))
    .filter((b) => Number.isFinite(b.close))
    .sort((a, b) => a.session.localeCompare(b.session));

  const deduped = [];
  for (const row of out) {
    if (marketOpen && row.session >= marketDate) continue;
    if (deduped.length && deduped[deduped.length - 1].session === row.session) {
      deduped[deduped.length - 1] = row;
    } else {
      deduped.push(row);
    }
  }
  return deduped;
}

function commonSessions(barsBySymbol) {
  let common = null;
  for (const symbol of UNIVERSE) {
    const set = new Set((barsBySymbol[symbol] || []).map((x) => x.session));
    common = common == null ? set : new Set([...common].filter((x) => set.has(x)));
  }
  return [...(common || [])].sort();
}

function signalFor(barsBySymbol) {
  const sessions = commonSessions(barsBySymbol);
  if (!sessions.length) throw new Error('No common completed sessions across V26 universe.');
  const signalSession = sessions[sessions.length - 1];
  const ranking = [];

  for (const symbol of UNIVERSE) {
    const rows = barsBySymbol[symbol].filter((x) => x.session <= signalSession);
    if (rows.length < SMA_DAYS) {
      throw new Error(`${symbol} has only ${rows.length} completed sessions; need ${SMA_DAYS}.`);
    }
    const closes = rows.map((x) => x.close);
    const close = closes[closes.length - 1];
    const past = closes[closes.length - 1 - MOMENTUM_DAYS];
    const momentum = close / past - 1;
    const sma150 = closes.slice(-SMA_DAYS).reduce((a, b) => a + b, 0) / SMA_DAYS;
    ranking.push({
      symbol,
      close,
      momentum,
      momentumPct: momentum * 100,
      sma150,
      eligible: momentum > 0 && close > sma150,
    });
  }

  ranking.sort((a, b) => b.momentum - a.momentum);
  const eligible = ranking.filter((x) => x.eligible);
  const targets = {};
  if (eligible[0]) targets[eligible[0].symbol] = WEIGHTS[0];
  if (eligible[1]) targets[eligible[1].symbol] = WEIGHTS[1];
  return { signalSession, sessions, ranking, targets };
}

function v26Order(order) {
  return String(order?.client_order_id || '').startsWith('v26-');
}

function sessionFromClientOrderId(id) {
  const m = /^v26-(\d{4})(\d{2})(\d{2})-/.exec(String(id || ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function relevantRebalanceOrders(orders) {
  const ignored = new Set(['canceled', 'rejected', 'expired']);
  return orders.filter((o) => v26Order(o) && !ignored.has(String(o.status || '').toLowerCase()));
}

function inferLastRebalanceSession(orders) {
  const sessions = relevantRebalanceOrders(orders)
    .map((o) => sessionFromClientOrderId(o.client_order_id))
    .filter(Boolean)
    .sort();
  return sessions.length ? sessions[sessions.length - 1] : null;
}

function currentPositionMap(positions) {
  const map = new Map();
  for (const p of positions || []) {
    if (UNIVERSE.includes(p.symbol)) map.set(p.symbol, p);
  }
  return map;
}

function buildOrders({ targets, positions, strategyBudget, signalSession, minNotional = 5 }) {
  const map = currentPositionMap(positions);
  const orders = [];

  for (const symbol of UNIVERSE) {
    const targetValue = strategyBudget * Number(targets[symbol] || 0);
    const pos = map.get(symbol);
    const currentValue = pos ? Math.max(0, Number(pos.market_value || 0)) : 0;
    const delta = targetValue - currentValue;
    if (Math.abs(delta) < minNotional) continue;

    const side = delta > 0 ? 'buy' : 'sell';
    const clientOrderId = `v26-${signalSession.replaceAll('-', '')}-${symbol}-${side}`;

    if (side === 'buy') {
      orders.push({
        symbol,
        side,
        type: 'market',
        time_in_force: 'day',
        notional: Math.max(0, delta).toFixed(2),
        extended_hours: false,
        client_order_id: clientOrderId,
      });
      continue;
    }

    if (!pos) continue;
    const qty = Number(pos.qty || 0);
    const price = Math.abs(Number(pos.current_price || 0));
    if (!(qty > 0) || !(price > 0)) continue;
    const sellQty = targetValue <= minNotional
      ? qty
      : Math.min(qty, Math.abs(delta) / price);
    if (sellQty * price < minNotional) continue;

    orders.push({
      symbol,
      side,
      type: 'market',
      time_in_force: 'day',
      qty: String(Number(sellQty.toFixed(9))),
      extended_hours: false,
      client_order_id: clientOrderId,
    });
  }

  orders.sort((a, b) => (a.side === b.side ? 0 : a.side === 'sell' ? -1 : 1));
  return orders;
}

async function snapshot(requestedBudget = DEFAULT_BUDGET) {
  const [account, positions, clock, orders, rawBars] = await Promise.all([
    getAccount('paper'),
    getPositions('paper'),
    getClock(),
    getOrders(),
    Promise.all(UNIVERSE.map((s) => getBars(s))),
  ]);

  const marketNow = new Date(clock?.timestamp || Date.now());
  const marketDate = easternDate(marketNow.toISOString());
  const barsBySymbol = Object.fromEntries(
    UNIVERSE.map((symbol, i) => [
      symbol,
      prepareBars(rawBars[i], Boolean(clock?.is_open), marketDate),
    ])
  );

  const { signalSession, sessions, ranking, targets } = signalFor(barsBySymbol);
  const lastRebalanceSession = inferLastRebalanceSession(orders);
  const completedSessionsSince = lastRebalanceSession
    ? sessions.filter((s) => s > lastRebalanceSession).length
    : REBALANCE_EVERY;
  const rebalanceDue = !lastRebalanceSession || completedSessionsSince >= REBALANCE_EVERY;

  const v26Positions = (positions || []).filter((p) => UNIVERSE.includes(p.symbol));
  const v26MarketValue = v26Positions.reduce(
    (sum, p) => sum + Math.max(0, Number(p.market_value || 0)),
    0
  );
  const cash = Math.max(0, Number(account?.cash || 0));
  const allocatable = cash + v26MarketValue;
  const budget = Math.min(Math.max(0, Number(requestedBudget) || DEFAULT_BUDGET), allocatable);

  const activeV26Orders = relevantRebalanceOrders(orders).filter((o) =>
    ['accepted', 'new', 'pending_new', 'partially_filled', 'held', 'calculated'].includes(
      String(o.status || '').toLowerCase()
    )
  );

  const proposedOrders = rebalanceDue && activeV26Orders.length === 0
    ? buildOrders({ targets, positions, strategyBudget: budget, signalSession })
    : [];

  return {
    strategy: 'V26_FROZEN_ROTATION',
    mode: 'paper',
    frozen: true,
    rule: {
      universe: UNIVERSE,
      momentumDays: MOMENTUM_DAYS,
      smaDays: SMA_DAYS,
      rebalanceEveryCompletedSessions: REBALANCE_EVERY,
      weights: WEIGHTS,
    },
    account: {
      equity: Number(account?.equity || 0),
      cash,
      buyingPower: Number(account?.buying_power || 0),
      status: account?.status || null,
    },
    market: {
      isOpen: Boolean(clock?.is_open),
      nextOpen: clock?.next_open || null,
      timestamp: clock?.timestamp || null,
    },
    signalSession,
    ranking,
    targets,
    requestedBudget: Number(requestedBudget) || DEFAULT_BUDGET,
    allocatable,
    strategyBudget: budget,
    positions: v26Positions.map((p) => ({
      symbol: p.symbol,
      qty: Number(p.qty || 0),
      marketValue: Number(p.market_value || 0),
      avgEntryPrice: Number(p.avg_entry_price || 0),
      currentPrice: Number(p.current_price || 0),
      unrealizedPl: Number(p.unrealized_pl || 0),
      unrealizedPlpc: Number(p.unrealized_plpc || 0),
    })),
    openOrders: activeV26Orders.map((o) => ({
      id: o.id,
      symbol: o.symbol,
      side: o.side,
      status: o.status,
      qty: o.qty ?? null,
      notional: o.notional ?? null,
      clientOrderId: o.client_order_id,
      submittedAt: o.submitted_at,
    })),
    lastRebalanceSession,
    completedSessionsSince,
    rebalanceDue,
    proposedOrders,
    updatedAt: new Date().toISOString(),
  };
}

router.get('/status', async (req, res) => {
  try {
    const budget = Number(req.query.budget || DEFAULT_BUDGET);
    res.json(await snapshot(budget));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/execute', async (req, res) => {
  try {
    if (req.body?.confirm !== 'PAPER_V26') {
      return res.status(400).json({ error: 'Paper confirmation token is required.' });
    }

    const requestedBudget = Number(req.body?.budget || DEFAULT_BUDGET);
    const before = await snapshot(requestedBudget);

    if (!before.rebalanceDue) {
      return res.json({ submitted: [], message: 'No V26 rebalance is due.', snapshot: before });
    }
    if (before.openOrders.length) {
      return res.status(409).json({
        error: 'V26 already has open paper orders. Wait for them to fill/cancel before another rebalance.',
        snapshot: before,
      });
    }

    const submitted = [];
    for (const order of before.proposedOrders) {
      const result = await jsonRequest(`${PAPER_BASE}/v2/orders`, {
        method: 'POST',
        body: JSON.stringify(order),
      });
      submitted.push({
        id: result.id,
        symbol: result.symbol,
        side: result.side,
        status: result.status,
        clientOrderId: result.client_order_id,
      });
    }

    const after = await snapshot(requestedBudget);
    return res.json({ submitted, message: 'V26 PAPER rebalance submitted.', snapshot: after });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
