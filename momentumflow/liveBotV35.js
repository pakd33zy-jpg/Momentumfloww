import express from 'express';
import { store } from './store.js';
import { createSession, createTrade, recomputeSessionStats } from './models.js';
import { evaluateLiveGate } from './safetyEngine.js';
import {
  getAccount,
  getPositions,
  getTradableAssets,
  getMarketClock,
  getStockSnapshots,
  getCryptoSnapshots,
  getStockBars,
  getCryptoBars,
  getLatestTradablePrice,
  hasCredentials,
  placeOrder,
  getOrder,
  cancelOrder,
  waitForFill,
} from './alpacaClient.js';
import {
  EQUITY_V35_DEFAULTS,
  evaluateEquityCandidateV35,
} from './equityStrategyV35.js';
import {
  CRYPTO_V35_DEFAULTS,
  evaluateCryptoCandidateV35,
  buildCryptoV35Budget,
} from './cryptoStrategyV35.js';

const router = express.Router();

const state = {
  running: false,
  mode: null,
  timer: null,
  sessionId: null,
  startedAt: null,
  lastTickAt: null,
  lastError: null,
  lastDecision: 'stopped',
  openTradeIds: [],
  equityCursor: 0,
  universe: { equities: [], crypto: [], refreshedAt: null },
  scanDiagnostics: null,
  topCandidates: [],
  nearMisses: [],
  cryptoBarsCache: { fetchedAt: 0, symbolsKey: '', bars15m: {}, bars1h: {}, bars1d: {} },
};

const DEFAULTS = {
  pollSeconds: 20,
  universeRefreshMinutes: 5,
  equityBatchSize: 500,
  equityDetailLimit: 80,
  maxOpenPositions: 8,
  maxEquityPositions: 8,
  stockFeed: 'iex',
  entryWaitMs: 15000,
  exitWaitMs: 15000,
  maxPositionFractionOfEquity: 0.20,
  equityRiskFractionCap: 0.01,
};

const cfg = () => ({ ...DEFAULTS, ...store.getConfig('liveBotConfig', {}) });
const strategyCfg = () => ({
  ...EQUITY_V35_DEFAULTS,
  ...CRYPTO_V35_DEFAULTS,
  ...store.getConfig('strategyConfig', {}),
});
const tradingCfg = () => ({ riskPerTrade: 0.01, ...store.getConfig('tradingConfig', {}) });

function selectedMode() {
  return store.getConfig('tradingMode', { mode: 'paper' }).mode === 'live' ? 'live' : 'paper';
}

function maxOpenPositions() {
  const value = Number(cfg().maxOpenPositions ?? 8);
  return Number.isFinite(value) ? Math.max(1, Math.min(8, Math.trunc(value))) : 8;
}

function accessCheck(mode) {
  if (mode === 'paper') {
    return hasCredentials('paper')
      ? { allowed: true, reason: null }
      : { allowed: false, reason: 'No Alpaca paper credentials on file.' };
  }
  return evaluateLiveGate({
    consents: store.getConfig('liveGateConsents', {}),
    hasLiveCredentials: hasCredentials('live'),
  });
}

function schedule() {
  if (!state.running) return;
  const ms = Math.max(5000, Number(cfg().pollSeconds || 20) * 1000);
  state.timer = setTimeout(tick, ms);
}

function stop(reason = null) {
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  state.running = false;
  if (reason) state.lastError = reason;
}

function normalizeSymbol(symbol = '') {
  const s = String(symbol).toUpperCase();
  if (s.includes('/')) return s;
  if (/^[A-Z]+USD$/.test(s)) return `${s.slice(0, -3)}/USD`;
  return s;
}

function sessionTrades() {
  if (!state.sessionId) return [];
  return store.getAll('trades').filter((t) => t.session_id === state.sessionId);
}

function syncOpenTradeIds() {
  state.openTradeIds = sessionTrades()
    .filter((t) => t.result === null && t.voided !== true && String(t.strategy_name || '').includes('V35'))
    .map((t) => t.id);
  return state.openTradeIds;
}

function saveTradePatch(tradeId, patch) {
  const trades = store.getAll('trades');
  const index = trades.findIndex((t) => t.id === tradeId);
  if (index < 0) throw new Error(`Trade ${tradeId} not found.`);
  trades[index] = { ...trades[index], ...patch };
  store.saveAll('trades', trades);
  return trades[index];
}

async function refreshUniverse(mode, force = false) {
  const age = state.universe.refreshedAt
    ? Date.now() - new Date(state.universe.refreshedAt).getTime()
    : Infinity;
  if (!force && age < Math.max(1, Number(cfg().universeRefreshMinutes || 5)) * 60000) return;
  const assets = await getTradableAssets(mode);
  state.universe = {
    equities: assets.equities || [],
    crypto: assets.crypto || [],
    refreshedAt: new Date().toISOString(),
  };
  if (state.equityCursor >= state.universe.equities.length) state.equityCursor = 0;
}

function stockBatch() {
  const rows = state.universe.equities || [];
  if (!rows.length) return [];
  const count = Math.min(rows.length, Math.max(1, Number(cfg().equityBatchSize || 500)));
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(rows[(state.equityCursor + i) % rows.length]);
  state.equityCursor = (state.equityCursor + count) % rows.length;
  return out;
}

function blockedSymbols(positions = []) {
  return new Set(
    positions
      .filter((p) => Math.abs(Number(p.qty || 0)) > 0)
      .map((p) => normalizeSymbol(p.symbol))
  );
}

function openRiskDollars() {
  return sessionTrades()
    .filter((t) => t.result === null && t.voided !== true && String(t.strategy_name || '').includes('V35'))
    .reduce((sum, t) => sum + Math.max(0, Number(t.planned_risk_dollars || 0)), 0);
}

function topActivity(snapshot) {
  const latest = Number(snapshot?.minuteBar?.c ?? snapshot?.latestTrade?.p ?? 0);
  const prev = Number(snapshot?.prevDailyBar?.c ?? snapshot?.dailyBar?.o ?? latest);
  const move = latest > 0 && prev > 0 ? Math.abs((latest / prev - 1) * 100) : 0;
  const volume = Math.max(0, Number(snapshot?.dailyBar?.v || snapshot?.minuteBar?.v || 0));
  return move + Math.log10(volume + 1) * 0.05;
}

async function scanCrypto(mode, positions) {
  const sc = strategyCfg();
  const assets = state.universe.crypto || [];
  const symbols = assets.map((a) => a.symbol).filter(Boolean);
  if (!symbols.length) return { candidates: [], nearMisses: [], detailed: 0 };

  const snapshots = await getCryptoSnapshots(mode, symbols);
  const blocked = blockedSymbols(positions);
  const detailSymbols = [...new Set([...symbols, 'BTC/USD'])];
  const symbolsKey = detailSymbols.slice().sort().join(',');
  const fresh = state.cryptoBarsCache.symbolsKey === symbolsKey && Date.now() - state.cryptoBarsCache.fetchedAt < 5 * 60000;

  if (!fresh) {
    const now = new Date();
    const [bars15m, bars1h, bars1d] = await Promise.all([
      getCryptoBars(mode, detailSymbols, {
        timeframe: '15Min',
        start: new Date(Date.now() - 14 * 24 * 60 * 60000),
        end: now,
        limit: 10000,
      }),
      Promise.all(detailSymbols.map(async (symbol) =>
        getCryptoBars(mode, [symbol], {
          timeframe: '1Hour',
          start: new Date(Date.now() - 60 * 24 * 60 * 60000),
          end: now,
          limit: 2000,
          maxPages: 2,
        })
      )).then((parts) => Object.assign({}, ...parts)),
      getCryptoBars(mode, detailSymbols, {
        timeframe: '1Day',
        start: new Date(Date.now() - 180 * 24 * 60 * 60000),
        end: now,
        limit: 10000,
      }),
    ]);
    state.cryptoBarsCache = { fetchedAt: Date.now(), symbolsKey, bars15m, bars1h, bars1d };
  }

  const candidates = [];
  const nearMisses = [];
  const btcBars1h = state.cryptoBarsCache.bars1h['BTC/USD'] || [];

  for (const asset of assets) {
    if (blocked.has(normalizeSymbol(asset.symbol))) continue;
    const compact = String(asset.symbol || '').replace('/', '');
    const snapshot = snapshots[asset.symbol] || snapshots[compact];
    if (!snapshot) {
      nearMisses.push({ symbol: asset.symbol, assetClass: 'crypto', reason: 'V35: no snapshot', score: 0 });
      continue;
    }
    const result = evaluateCryptoCandidateV35({
      asset,
      snapshot,
      bars15m: state.cryptoBarsCache.bars15m[asset.symbol] || [],
      bars1h: state.cryptoBarsCache.bars1h[asset.symbol] || [],
      bars1d: state.cryptoBarsCache.bars1d[asset.symbol] || [],
      btcBars1h,
      config: sc,
    });
    if (result.signal) candidates.push(result.signal);
    else nearMisses.push({
      symbol: asset.symbol,
      assetClass: 'crypto',
      reason: result.reason || result.diagnostics?.reason || 'V35: no signal',
      score: Number(result.diagnostics?.score ?? result.score ?? 0),
    });
  }

  return { candidates, nearMisses, detailed: assets.length };
}

async function scanEquities(mode, positions) {
  const clock = await getMarketClock(mode);
  if (!clock?.is_open) return { candidates: [], nearMisses: [], detailed: 0, marketOpen: false };

  const batch = stockBatch();
  if (!batch.length) return { candidates: [], nearMisses: [], detailed: 0, marketOpen: true };

  const symbols = batch.map((a) => a.symbol);
  const snapshots = await getStockSnapshots(mode, symbols, { feed: cfg().stockFeed || 'iex' });
  const blocked = blockedSymbols(positions);

  const ranked = batch
    .map((asset) => ({ asset, snapshot: snapshots[asset.symbol], activity: topActivity(snapshots[asset.symbol]) }))
    .filter((x) => x.snapshot && !blocked.has(normalizeSymbol(x.asset.symbol)))
    .sort((a, b) => b.activity - a.activity)
    .slice(0, Math.max(1, Number(cfg().equityDetailLimit || 80)));

  if (!ranked.length) return { candidates: [], nearMisses: [], detailed: 0, marketOpen: true };

  const detailSymbols = [...new Set([...ranked.map((x) => x.asset.symbol), 'SPY', 'QQQ'])];
  const barsBySymbol = await getStockBars(mode, detailSymbols, {
    timeframe: '1Min',
    start: new Date(Date.now() - 12 * 60 * 60000),
    end: new Date(),
    limit: 10000,
    feed: cfg().stockFeed || 'iex',
  });

  const spy = barsBySymbol.SPY || [];
  const qqq = barsBySymbol.QQQ || [];
  const ret = (bars, n = 15) => {
    if (!Array.isArray(bars) || bars.length <= n) return 0;
    const a = Number(bars.at(-(n + 1))?.c || 0);
    const b = Number(bars.at(-1)?.c || 0);
    return a > 0 && b > 0 ? (b / a - 1) * 100 : 0;
  };
  const marketMove = (ret(spy, 15) + ret(qqq, 15)) / 2;
  const marketRegime = { direction: marketMove > 0.12 ? 'LONG' : marketMove < -0.12 ? 'SHORT' : 'NEUTRAL', move15Pct: marketMove };

  const candidates = [];
  const nearMisses = [];
  const sc = strategyCfg();
  for (const item of ranked) {
    const result = evaluateEquityCandidateV35({
      asset: item.asset,
      snapshot: item.snapshot,
      bars: barsBySymbol[item.asset.symbol] || [],
      marketRegime,
      config: sc,
    });
    if (result.signal) candidates.push(result.signal);
    else nearMisses.push({
      symbol: item.asset.symbol,
      assetClass: 'us_equity',
      reason: result.reason || result.diagnostics?.reason || 'V35: no signal',
      score: Number(result.diagnostics?.score ?? result.score ?? 0),
    });
  }
  return { candidates, nearMisses, detailed: ranked.length, marketOpen: true };
}

async function scan(mode) {
  await refreshUniverse(mode);
  const positions = await getPositions(mode);
  const [crypto, equity] = await Promise.all([
    scanCrypto(mode, positions),
    scanEquities(mode, positions),
  ]);

  const candidates = [...crypto.candidates, ...equity.candidates]
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const nearMisses = [...crypto.nearMisses, ...equity.nearMisses]
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 20);

  state.topCandidates = candidates.slice(0, 10).map((c) => ({
    symbol: c.symbol,
    assetClass: c.assetClass,
    direction: c.direction,
    strategy: c.strategy,
    score: c.score,
    trigger: c.signal?.trigger || c.signal?.playbook || null,
  }));
  state.nearMisses = nearMisses;
  state.scanDiagnostics = {
    scannedAt: new Date().toISOString(),
    counts: {
      cryptoUniverse: state.universe.crypto.length,
      equityUniverse: state.universe.equities.length,
      cryptoDetailed: crypto.detailed,
      equityDetailed: equity.detailed,
      cryptoQualified: crypto.candidates.length,
      equityQualified: equity.candidates.length,
    },
    marketOpen: equity.marketOpen === true,
    engines: {
      crypto: 'CRYPTO_V35_STANDALONE',
      equities: 'EQUITY_V35_STANDALONE',
    },
  };

  return { best: candidates[0] || null, positions };
}

async function settleOrder(mode, orderId, timeoutMs) {
  let order = await waitForFill(mode, orderId, { timeoutMs, intervalMs: 750 });
  if (['filled', 'canceled', 'expired', 'rejected'].includes(order.status)) return order;
  try { await cancelOrder(mode, orderId); } catch {}
  order = await waitForFill(mode, orderId, { timeoutMs: 5000, intervalMs: 500 });
  return getOrder(mode, orderId);
}

function equityBudget(account, best) {
  const equity = Number(account.equity || account.portfolio_value || account.cash || 0);
  const buyingPower = Number(account.buying_power || account.cash || 0);
  const stopPct = Number(best.signal?.exitPlan?.stopLossPct || 0);
  if (!(equity > 0) || !(buyingPower > 0) || !(stopPct > 0)) return { positionBudget: 0, riskDollars: 0, riskFraction: 0 };
  const requested = Number(tradingCfg().riskPerTrade ?? 0.01);
  const cap = Math.max(0.001, Math.min(0.01, Number(cfg().equityRiskFractionCap || 0.01)));
  const riskFraction = Math.max(0.001, Math.min(cap, Number.isFinite(requested) ? requested : 0.01));
  const costPct = Math.max(0, Number(best.signal?.exitPlan?.estimatedRoundTripCostPct || 0));
  const riskDollars = equity * riskFraction;
  const riskSized = riskDollars / ((stopPct + costPct) / 100);
  const positionBudget = Math.min(riskSized, equity * Math.max(0.01, Math.min(0.20, Number(cfg().maxPositionFractionOfEquity || 0.20))), buyingPower * 0.90);
  return { positionBudget, riskDollars, riskFraction };
}

async function enter(mode) {
  syncOpenTradeIds();
  if (state.openTradeIds.length >= maxOpenPositions()) {
    state.lastDecision = `${mode.toUpperCase()} managing ${state.openTradeIds.length}/${maxOpenPositions()} V35 positions`;
    return false;
  }

  const { best, positions } = await scan(mode);
  if (!best) {
    state.lastDecision = `${mode.toUpperCase()} V35 analyzed ${state.scanDiagnostics?.counts?.cryptoDetailed || 0} crypto / ${state.scanDiagnostics?.counts?.equityDetailed || 0} equities; no V35 setup`;
    return false;
  }

  const account = await getAccount(mode);
  const equity = Number(account.equity || account.portfolio_value || account.cash || 0);
  const cash = Number(account.cash || 0);
  const currentCryptoPositions = positions.filter((p) => String(p.asset_class || '').toLowerCase() === 'crypto' && Math.abs(Number(p.qty || 0)) > 0).length;
  const maxCrypto = Math.max(1, Math.min(8, Number(strategyCfg().cryptoV35MaxConcurrentPositions || 8)));

  if (best.assetClass === 'crypto' && currentCryptoPositions >= maxCrypto) {
    state.lastDecision = `${mode.toUpperCase()} ${best.symbol} skipped - ${currentCryptoPositions}/${maxCrypto} Crypto V35 position limit`;
    return false;
  }

  const currentCryptoExposure = positions
    .filter((p) => String(p.asset_class || '').toLowerCase() === 'crypto')
    .reduce((sum, p) => sum + Math.abs(Number(p.market_value || 0)), 0);

  let positionBudget = 0;
  let plannedRiskDollars = 0;
  let riskFraction = 0;
  if (best.assetClass === 'crypto') {
    positionBudget = buildCryptoV35Budget({
      equity,
      cash,
      currentCryptoExposure,
      currentOpenRiskDollars: openRiskDollars(),
      signal: best,
      config: strategyCfg(),
    });
    riskFraction = Number(strategyCfg().cryptoV35RiskFraction || 0.01);
    plannedRiskDollars = equity * riskFraction;
  } else {
    const sized = equityBudget(account, best);
    positionBudget = sized.positionBudget;
    plannedRiskDollars = sized.riskDollars;
    riskFraction = sized.riskFraction;
  }

  if (!(positionBudget > 1)) {
    state.lastDecision = `${mode.toUpperCase()} ${best.symbol} skipped - V35 risk/exposure budget has no room`;
    return false;
  }

  state.lastDecision = `entering ${mode.toUpperCase()} ${best.direction} ${best.symbol} — ${best.strategy} score ${best.score}`;
  const order = await placeOrder({
    mode,
    symbol: best.symbol,
    notional: best.direction === 'SHORT' ? undefined : Number(positionBudget.toFixed(2)),
    qty: best.direction === 'SHORT' ? String(Math.floor(positionBudget / Number(best.price))) : undefined,
    side: best.direction === 'SHORT' ? 'sell' : 'buy',
    type: 'market',
    timeInForce: best.assetClass === 'crypto' ? 'gtc' : 'day',
  });

  const fill = await settleOrder(mode, order.id, Number(cfg().entryWaitMs || 15000));
  const filledQty = Number(fill.filled_qty || 0);
  const entryPrice = Number(fill.filled_avg_price || 0);
  if (!(filledQty > 0) || !(entryPrice > 0)) {
    state.lastDecision = `${mode.toUpperCase()} ${best.symbol} not opened — order ${fill.status}`;
    return false;
  }

  const session = store.getOne('sessions', state.sessionId);
  if (!session) throw new Error('V35 session not found.');
  const trade = createTrade({
    sessionId: session.id,
    market: best.symbol,
    marketName: best.name || best.symbol,
    direction: best.direction,
    conviction: best.score >= 8 ? 'high' : best.score >= 6.5 ? 'standard' : 'probe',
    entryPrice,
  });
  const exitPlan = best.signal?.exitPlan || {};
  Object.assign(trade, {
    asset_class: best.assetClass,
    execution_mode: mode,
    alpaca_order_id: order.id,
    qty: String(fill.filled_qty),
    filled_qty: String(fill.filled_qty),
    strategy_name: best.strategy,
    quality_score: best.score,
    planned_position_budget: Number(positionBudget.toFixed(4)),
    planned_risk_dollars: Number(plannedRiskDollars.toFixed(4)),
    requested_risk_fraction: riskFraction,
    effective_risk_fraction: riskFraction,
    stop_loss_pct: Number(exitPlan.stopLossPct || 0),
    take_profit_pct: Number(exitPlan.takeProfitPct || 0),
    trail_trigger_pct: Number(exitPlan.trailTriggerPct || 0),
    trail_distance_pct: Number(exitPlan.trailDistancePct || 0),
    trail_floor_pct: Number(exitPlan.trailFloorPct || 0),
    max_hold_minutes: Number(exitPlan.maxHoldMinutes || 35),
    best_favorable_move_pct: 0,
    entry_signal: best.signal || {},
  });
  store.insert('trades', trade);
  state.openTradeIds.push(trade.id);
  state.lastDecision = `entered ${mode.toUpperCase()} ${best.direction} ${best.symbol} — ${best.strategy} score ${best.score} — ${state.openTradeIds.length}/${maxOpenPositions()} V35 positions`;
  return true;
}

async function closeTrade(mode, trade, price, reason) {
  const qty = Math.abs(Number(trade.filled_qty ?? trade.qty ?? 0));
  if (!(qty > 0)) throw new Error(`No close quantity for ${trade.market}.`);
  const side = trade.direction === 'SHORT' ? 'buy' : 'sell';
  const order = await placeOrder({
    mode,
    symbol: trade.market,
    qty: String(qty),
    side,
    type: 'market',
    timeInForce: trade.asset_class === 'crypto' ? 'gtc' : 'day',
  });
  const fill = await settleOrder(mode, order.id, Number(cfg().exitWaitMs || 15000));
  const filledQty = Number(fill.filled_qty || 0);
  const exitPrice = Number(fill.filled_avg_price || 0);
  if (!(filledQty > 0) || !(exitPrice > 0)) throw new Error(`Exit for ${trade.market} did not fill (${fill.status}).`);

  const entryPrice = Number(trade.entry_price);
  const gross = trade.direction === 'SHORT'
    ? (entryPrice - exitPrice) * filledQty
    : (exitPrice - entryPrice) * filledQty;
  const costPct = Math.max(0, Number(trade.entry_signal?.exitPlan?.estimatedRoundTripCostPct || 0));
  const cost = entryPrice * filledQty * costPct / 100;
  const pnl = gross - cost;
  const result = pnl >= 0 ? 'win' : 'loss';
  const closed = saveTradePatch(trade.id, {
    exit_price: exitPrice,
    exit_qty: filledQty,
    exit_order_id: order.id,
    pnl: Number(pnl.toFixed(4)),
    gross_pnl: Number(gross.toFixed(4)),
    result,
    exit_reason: reason,
    closed_at: new Date().toISOString(),
  });

  const session = store.getOne('sessions', trade.session_id);
  if (session) {
    recomputeSessionStats(session, store.getAll('trades'));
    store.update('sessions', session.id, session);
  }
  state.openTradeIds = state.openTradeIds.filter((id) => id !== trade.id);
  state.lastDecision = `closed ${mode.toUpperCase()} ${trade.direction} ${trade.market} — ${reason}`;
  return closed;
}

async function manageOne(mode, trade) {
  const price = await getLatestTradablePrice(mode, trade.market, trade.asset_class || (String(trade.market).includes('/') ? 'crypto' : 'us_equity'));
  const entry = Number(trade.entry_price);
  if (!(entry > 0) || !(price > 0)) return;
  const raw = (price / entry - 1) * 100;
  const favorable = trade.direction === 'SHORT' ? -raw : raw;
  const priorBest = Number(trade.best_favorable_move_pct || 0);
  const best = Math.max(priorBest, favorable);
  if (best > priorBest) saveTradePatch(trade.id, { best_favorable_move_pct: Number(best.toFixed(4)), last_mark_price: price, last_mark_at: new Date().toISOString() });

  const stop = Math.max(0, Number(trade.stop_loss_pct || 0));
  const target = Math.max(0, Number(trade.take_profit_pct || 0));
  const trailTrigger = Math.max(0, Number(trade.trail_trigger_pct || 0));
  const trailDistance = Math.max(0, Number(trade.trail_distance_pct || 0));
  const trailFloor = Math.max(0, Number(trade.trail_floor_pct || 0));
  const ageMin = (Date.now() - new Date(trade.timestamp || 0).getTime()) / 60000;
  const maxHold = Math.max(5, Number(trade.max_hold_minutes || 35));

  if (target > 0 && favorable >= target) return closeTrade(mode, trade, price, `V35 take profit +${favorable.toFixed(3)}%`);
  if (stop > 0 && favorable <= -stop) return closeTrade(mode, trade, price, `V35 stop ${favorable.toFixed(3)}%`);
  if (trailTrigger > 0 && best >= trailTrigger && favorable <= Math.max(trailFloor, best - trailDistance)) {
    return closeTrade(mode, trade, price, `V35 trailing exit; best +${best.toFixed(3)}%, now ${favorable.toFixed(3)}%`);
  }
  if (ageMin >= maxHold) return closeTrade(mode, trade, price, `V35 max hold ${ageMin.toFixed(1)}m`);
}

async function manageOpenTrades(mode) {
  syncOpenTradeIds();
  for (const id of [...state.openTradeIds]) {
    const trade = store.getOne('trades', id);
    if (!trade || trade.result !== null) continue;
    state.lastDecision = `managing ${mode.toUpperCase()} ${state.openTradeIds.length}/${maxOpenPositions()} V35 positions — ${trade.direction} ${trade.market}`;
    await manageOne(mode, trade);
  }
  syncOpenTradeIds();
}

function strategyPerformance() {
  const groups = new Map();
  for (const t of store.getAll('trades').filter((x) => x.result !== null && String(x.strategy_name || '').includes('V35'))) {
    const key = t.strategy_name;
    if (!groups.has(key)) groups.set(key, { strategy: key, trades: 0, wins: 0, losses: 0, pnl: 0, grossWin: 0, grossLoss: 0 });
    const g = groups.get(key);
    const pnl = Number(t.pnl || 0);
    g.trades += 1;
    g.pnl += pnl;
    if (pnl > 0) { g.wins += 1; g.grossWin += pnl; }
    else if (pnl < 0) { g.losses += 1; g.grossLoss += Math.abs(pnl); }
  }
  return [...groups.values()].map((g) => ({
    strategy: g.strategy,
    trades: g.trades,
    wins: g.wins,
    losses: g.losses,
    winRate: g.trades ? Number((g.wins / g.trades * 100).toFixed(2)) : 0,
    pnl: Number(g.pnl.toFixed(4)),
    expectancy: g.trades ? Number((g.pnl / g.trades).toFixed(4)) : 0,
    profitFactor: g.grossLoss > 0 ? Number((g.grossWin / g.grossLoss).toFixed(3)) : g.grossWin > 0 ? 'Infinity' : 0,
    sampleEnough: g.trades >= 30,
  }));
}

function pub() {
  syncOpenTradeIds();
  const sc = strategyCfg();
  return {
    running: state.running,
    mode: state.mode,
    sessionId: state.sessionId,
    startedAt: state.startedAt,
    lastTickAt: state.lastTickAt,
    lastError: state.lastError,
    lastDecision: state.lastDecision,
    openTradeIds: [...state.openTradeIds],
    openPositionCount: state.openTradeIds.length,
    maxOpenPositions: maxOpenPositions(),
    scanDiagnostics: state.scanDiagnostics,
    topCandidates: state.topCandidates,
    nearMisses: state.nearMisses,
    strategyPerformance: strategyPerformance(),
    activeScanCounts: {
      equities: Number(state.scanDiagnostics?.counts?.equityDetailed || 0),
      crypto: Number(state.scanDiagnostics?.counts?.cryptoDetailed || 0),
    },
    universe: {
      equityCount: state.universe.equities.length,
      cryptoCount: state.universe.crypto.length,
      totalCount: state.universe.equities.length + state.universe.crypto.length,
      total: state.universe.equities.length + state.universe.crypto.length,
      refreshedAt: state.universe.refreshedAt,
    },
    strategyVersion: 'v35-standalone-equity+crypto',
    engines: {
      equities: {
        strategy: 'EQUITY_V35_STANDALONE',
        enabled: sc.equityV35Enabled !== false,
        maxPositions: Number(cfg().maxEquityPositions || 8),
      },
      crypto: {
        strategy: 'CRYPTO_V35_STANDALONE',
        enabled: sc.cryptoV35Enabled !== false,
        maxPositions: Math.max(1, Math.min(8, Number(sc.cryptoV35MaxConcurrentPositions || 8))),
      },
    },
    config: {
      ...cfg(),
      maxOpenPositions: maxOpenPositions(),
      equityDirections: 'LONG_AND_SHORT',
      cryptoDirections: 'LONG_ONLY',
      execution: state.mode === 'paper' ? 'ALPACA_PAPER' : state.mode === 'live' ? 'ALPACA_LIVE' : null,
    },
    strategyConfig: sc,
  };
}

async function tick() {
  if (!state.running) return;
  const mode = state.mode;
  try {
    if (selectedMode() !== mode) {
      stop(`Trading mode changed from ${mode} to ${selectedMode()}.`);
      return;
    }
    const access = accessCheck(mode);
    if (!access.allowed) {
      stop(`${mode.toUpperCase()} access closed: ${access.reason}`);
      return;
    }
    state.lastTickAt = new Date().toISOString();
    state.lastError = null;
    await manageOpenTrades(mode);
    if (state.running && state.openTradeIds.length < maxOpenPositions()) await enter(mode);
  } catch (error) {
    console.error(`[v35-${mode}]`, error);
    state.lastError = error.message;
    state.lastDecision = `V35 error: ${error.message}`;
  } finally {
    schedule();
  }
}

router.get('/status', (req, res) => res.json(pub()));
router.get('/rejection-log', (req, res) => {
  const rows = state.nearMisses.map((x, index) => ({
    id: `v35-${Date.now()}-${index}`,
    timestamp: state.scanDiagnostics?.scannedAt || new Date().toISOString(),
    mode: state.mode || selectedMode(),
    strategy_version: 'v35-standalone-equity+crypto',
    near_misses: [x],
    counts: state.scanDiagnostics?.counts || {},
    top_prefilter_rejections: { equities: [], crypto: [] },
    top_strategy_rejections: { equities: [], crypto: [] },
  }));
  res.json(rows.slice(0, Math.max(1, Math.min(100, Number(req.query.limit || 100)))));
});
router.delete('/rejection-log', (req, res) => { state.nearMisses = []; res.json({ ok: true }); });

router.post('/start', async (req, res) => {
  try {
    if (state.running) return res.json(pub());
    const mode = selectedMode();
    const access = accessCheck(mode);
    if (!access.allowed) return res.status(409).json({ error: access.reason });
    const account = await getAccount(mode);
    const startingCapital = Number(account.equity || account.portfolio_value || account.cash || 0);
    if (!(startingCapital > 0)) return res.status(409).json({ error: `Alpaca ${mode} account has no valid equity.` });
    const session = createSession({ mode, startingCapital });
    store.insert('sessions', session);
    state.running = true;
    state.mode = mode;
    state.sessionId = session.id;
    state.startedAt = new Date().toISOString();
    state.lastTickAt = null;
    state.lastError = null;
    state.lastDecision = `V35 ${mode.toUpperCase()} starting — Equity V35 + Crypto V35 independent engines`;
    state.openTradeIds = [];
    await refreshUniverse(mode, true);
    schedule();
    return res.json(pub());
  } catch (error) {
    return res.status(500).json({ error: `V35 start failed: ${error.message}` });
  }
});

router.post('/stop', (req, res) => {
  stop();
  if (state.sessionId) {
    const session = store.getOne('sessions', state.sessionId);
    if (session && session.status === 'running') {
      store.update('sessions', session.id, { status: 'halted', halt_reason: 'Stopped by user', completed_at: new Date().toISOString() });
    }
  }
  state.lastDecision = 'V35 stopped';
  res.json(pub());
});

export default router;
