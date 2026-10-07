import express from 'express';
import { getCryptoBars, getCryptoSnapshots } from './alpacaClient.js';
import { evaluateCryptoCandidateC62 } from './cryptoStrategyC62.js';
import { store } from './store.js';
import { persistConfig } from './persistentCredentialStore.js';

const router = express.Router();

const STORE_KEY = 'c62ShadowState';
const SYMBOLS = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'LINK/USD'];
const TARGETS = SYMBOLS.filter((s) => s !== 'BTC/USD');

const STARTING_EQUITY = 100000;
const RISK_FRACTION = 0.01;
const MAX_PORTFOLIO_RISK = 0.08;
const MAX_TOTAL_EXPOSURE = 0.80;
const MAX_POSITION_FRACTION = 0.20;
const REENTRY_COOLDOWN_MS = 15 * 60 * 1000;
const HISTORY_REFRESH_MS = 5 * 60 * 1000;
const POLL_MS = 60 * 1000;

const runtime = {
  running: false,
  busy: false,
  timer: null,
  lastTickAt: null,
  lastDecision: 'C62 shadow stopped',
  lastError: null,
  historyFetchedAt: 0,
  bars15m: {},
  scans: 0,
  qualifications: 0,
};

function blankState() {
  return {
    startedAt: null,
    paperEquity: STARTING_EQUITY,
    peakEquity: STARTING_EQUITY,
    maxDrawdownPct: 0,
    positions: {},
    closedTrades: [],
    reentryAfter: {},
    updatedAt: null,
  };
}

function state() {
  return { ...blankState(), ...store.getConfig(STORE_KEY, {}) };
}

async function save(next, persist = true) {
  const row = { ...blankState(), ...next, updatedAt: new Date().toISOString() };
  store.setConfig(STORE_KEY, row);
  if (persist) {
    try {
      await persistConfig(STORE_KEY, row);
    } catch (error) {
      console.warn('[c62-shadow] persist skipped:', error.message);
    }
  }
  return row;
}

function n(value, fallback = NaN) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function compact(symbol) {
  return String(symbol || '').replace('/', '').toUpperCase();
}

function currentExposure(s) {
  return Object.values(s.positions || {}).reduce((sum, p) => sum + Math.max(0, n(p.notional, 0)), 0);
}

function currentOpenRisk(s) {
  return Object.values(s.positions || {}).reduce((sum, p) => sum + Math.max(0, n(p.riskDollars, 0)), 0);
}

function updateDrawdown(s) {
  s.peakEquity = Math.max(n(s.peakEquity, STARTING_EQUITY), n(s.paperEquity, STARTING_EQUITY));
  if (s.peakEquity > 0) {
    s.maxDrawdownPct = Math.max(
      n(s.maxDrawdownPct, 0),
      ((s.peakEquity - s.paperEquity) / s.peakEquity) * 100,
    );
  }
}

function summary(s = state()) {
  const closed = Array.isArray(s.closedTrades) ? s.closedTrades : [];
  const wins = closed.filter((x) => n(x.pnl, 0) > 0);
  const losses = closed.filter((x) => n(x.pnl, 0) < 0);
  const grossWin = wins.reduce((sum, x) => sum + n(x.pnl, 0), 0);
  const grossLoss = Math.abs(losses.reduce((sum, x) => sum + n(x.pnl, 0), 0));
  const open = Object.values(s.positions || {});
  const unrealized = open.reduce((sum, p) => {
    const mark = n(p.lastPrice, p.entry);
    return sum + (p.legs || []).reduce(
      (legSum, leg) => legSum + n(leg.notional, 0) * ((mark / n(leg.entry, mark)) - 1),
      0,
    );
  }, 0);

  return {
    strategy: 'CRYPTO_C62_LEAD_LAG_SHADOW',
    startingEquity: STARTING_EQUITY,
    paperEquity: Number(n(s.paperEquity, STARTING_EQUITY).toFixed(2)),
    realizedReturnPct: Number(((n(s.paperEquity, STARTING_EQUITY) / STARTING_EQUITY - 1) * 100).toFixed(3)),
    unrealizedPnl: Number(unrealized.toFixed(2)),
    maxDrawdownPct: Number(n(s.maxDrawdownPct, 0).toFixed(3)),
    scans: runtime.scans,
    qualifications: runtime.qualifications,
    openPositions: open.length,
    closedTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: closed.length ? Number((wins.length / closed.length * 100).toFixed(2)) : 0,
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(3)) : (grossWin > 0 ? 999 : 0),
  };
}

async function refreshHistory(now) {
  if (runtime.historyFetchedAt && Date.now() - runtime.historyFetchedAt < HISTORY_REFRESH_MS) return;
  const start = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
  const bars = await getCryptoBars('paper', SYMBOLS, {
    timeframe: '15Min',
    start,
    end: now,
    limit: 10000,
    maxPages: 4,
    sort: 'asc',
  });
  runtime.bars15m = Object.fromEntries(
    SYMBOLS.map((symbol) => [symbol, bars?.[symbol] || bars?.[compact(symbol)] || []]),
  );
  runtime.historyFetchedAt = Date.now();
}

function positionBudget(s, signal) {
  const equity = Math.max(0, n(s.paperEquity, STARTING_EQUITY));
  const stopPct = Math.max(0, n(signal?.signal?.exitPlan?.stopLossPct, 0));
  const costPct = Math.max(0, n(signal?.signal?.exitPlan?.estimatedRoundTripCostPct, 1));
  if (!(equity > 0) || !(stopPct > 0)) return 0;

  const exposure = currentExposure(s);
  const openRisk = currentOpenRisk(s);
  const cash = Math.max(0, equity - exposure);
  const riskRoom = Math.max(0, equity * MAX_PORTFOLIO_RISK - openRisk);
  const desiredRisk = Math.min(equity * RISK_FRACTION, riskRoom);
  if (!(desiredRisk > 0)) return 0;

  const riskSized = desiredRisk / ((stopPct + costPct) / 100);
  const exposureRoom = Math.max(0, equity * MAX_TOTAL_EXPOSURE - exposure);
  return Math.max(0, Math.min(
    riskSized,
    equity * MAX_POSITION_FRACTION,
    exposureRoom,
    cash,
  ));
}

async function closePosition(s, symbol, exit, reason, now) {
  const p = s.positions?.[symbol];
  if (!p || !(exit > 0)) return false;

  const pnl = (p.legs || []).reduce(
    (sum, leg) => sum + n(leg.notional, 0) * ((((exit / n(leg.entry, exit)) - 1) * 100 - n(p.costPct, 1)) / 100),
    0,
  );
  const netPct = n(p.notional, 0) > 0 ? pnl / p.notional * 100 : 0;
  s.paperEquity = n(s.paperEquity, STARTING_EQUITY) + pnl;
  updateDrawdown(s);

  s.closedTrades = [
    ...(s.closedTrades || []),
    {
      symbol,
      strategy: 'CRYPTO_C62_LEAD_LAG_SHADOW',
      entry: p.entry,
      exit,
      netPct: Number(netPct.toFixed(4)),
      pnl: Number(pnl.toFixed(2)),
      reason,
      openedAt: new Date(p.openedAt).toISOString(),
      closedAt: now.toISOString(),
    },
  ].slice(-5000);

  delete s.positions[symbol];
  s.reentryAfter = { ...(s.reentryAfter || {}), [symbol]: now.getTime() + REENTRY_COOLDOWN_MS };
  await save(s, true);
  return true;
}

async function checkExit(s, symbol, snapshot, now) {
  const p = s.positions?.[symbol];
  if (!p) return false;

  const bar = snapshot?.minuteBar || {};
  const latest = n(snapshot?.latestTrade?.p ?? bar?.c);
  if (!(latest > 0)) return false;
  p.lastPrice = latest;
  p.lastMarkAt = now.toISOString();

  const rawBarTime = bar?.t ?? bar?.timestamp ?? bar?.time;
  const parsedBarTime = typeof rawBarTime === 'number' ? rawBarTime : Date.parse(rawBarTime || '');
  const barTimeMs = Number.isFinite(parsedBarTime) ? (parsedBarTime < 1e12 ? parsedBarTime * 1000 : parsedBarTime) : NaN;
  const entryMinuteBucket = Math.floor(n(p.entryMinuteStart, p.openedAt) / 60000) * 60000;
  const barMinuteBucket = Number.isFinite(barTimeMs) ? Math.floor(barTimeMs / 60000) * 60000 : NaN;
  const barIsPostEntryMinute = Number.isFinite(barMinuteBucket) && barMinuteBucket > entryMinuteBucket;
  const high = barIsPostEntryMinute ? n(bar?.h, latest) : latest;
  const low = barIsPostEntryMinute ? n(bar?.l, latest) : latest;

  let effectiveStop = n(p.stopPrice, 0);
  const gainFromEntryPct = (n(p.peakPrice, p.entry) / p.entry - 1) * 100;
  if (gainFromEntryPct >= n(p.trailTriggerPct, Infinity)) {
    const trailByDistance = n(p.peakPrice, p.entry) * (1 - n(p.trailDistancePct, 0) / 100);
    const trailFloor = p.entry * (1 + n(p.trailFloorPct, 0) / 100);
    effectiveStop = Math.max(effectiveStop, trailByDistance, trailFloor);
  }

  const stopHit = low <= effectiveStop;
  const targetHit = high >= n(p.targetPrice, Infinity);
  if (stopHit) {
    await closePosition(s, symbol, effectiveStop, targetHit ? 'STOP_SAME_BAR' : 'STOP_OR_TRAIL', now);
    return true;
  }
  if (targetHit) {
    await closePosition(s, symbol, p.targetPrice, 'TARGET', now);
    return true;
  }
  if (now.getTime() - n(p.openedAt, now.getTime()) >= n(p.maxHoldMinutes, 1440) * 60000) {
    await closePosition(s, symbol, latest, 'MAX_HOLD', now);
    return true;
  }

  if (!p.added && high >= n(p.addPrice, Infinity)) {
    const available = Math.max(0, n(s.paperEquity, STARTING_EQUITY) * MAX_TOTAL_EXPOSURE - currentExposure(s));
    const addNotional = Math.min(n(p.plannedNotional, 0) * (1 - n(p.initialWeight, 0.5)), available);
    if (addNotional > 0) {
      p.legs.push({ entry: p.addPrice, notional: addNotional });
      p.notional += addNotional;
      p.added = true;
      await save(s, true);
    }
  }

  p.peakPrice = Math.max(n(p.peakPrice, p.entry), high, latest);
  return false;
}

async function enter(s, signal, now) {
  const symbol = signal?.symbol;
  if (!symbol || s.positions?.[symbol]) return false;
  if (n(s.reentryAfter?.[symbol], 0) > now.getTime()) return false;

  const plan = signal?.signal?.exitPlan || {};
  const stopPct = n(plan.stopLossPct);
  const targetPct = n(plan.takeProfitPct);
  const entry = n(signal.price);
  if (!(stopPct > 0) || !(targetPct > 0) || !(entry > 0)) return false;

  const plannedNotional = positionBudget(s, signal);
  if (!(plannedNotional > 0)) return false;

  const initialWeight = Math.max(0.1, Math.min(1, n(plan.initialWeight, 0.5)));
  const initialNotional = plannedNotional * initialWeight;
  const stopPrice = entry * (1 - stopPct / 100);
  const targetPrice = entry * (1 + targetPct / 100);

  s.positions = {
    ...(s.positions || {}),
    [symbol]: {
      symbol,
      strategy: 'CRYPTO_C62_LEAD_LAG_SHADOW',
      score: signal.score,
      entry,
      stopPrice,
      targetPrice,
      notional: initialNotional,
      plannedNotional,
      initialWeight,
      legs: [{ entry, notional: initialNotional }],
      addPrice: entry * (1 + stopPct / 100 * n(plan.scaleInAtRiskMultiple, 1)),
      added: initialWeight >= 1,
      riskDollars: plannedNotional * (stopPct + n(plan.estimatedRoundTripCostPct, 1)) / 100,
      costPct: n(plan.estimatedRoundTripCostPct, 1),
      maxHoldMinutes: Math.max(5, n(plan.maxHoldMinutes, 1440)),
      trailTriggerPct: Math.max(0, n(plan.trailTriggerPct, stopPct)),
      trailDistancePct: Math.max(0.05, n(plan.trailDistancePct, stopPct * 0.65)),
      trailFloorPct: Math.max(0, n(plan.trailFloorPct, 0)),
      peakPrice: entry,
      lastPrice: entry,
      entryMinuteStart: now.getTime(),
      openedAt: now.getTime(),
      signal: signal.signal,
    },
  };
  delete s.reentryAfter?.[symbol];
  await save(s, true);
  return true;
}

async function tick() {
  if (!runtime.running || runtime.busy) return;
  runtime.busy = true;

  try {
    const now = new Date();
    runtime.lastTickAt = now.toISOString();
    runtime.lastError = null;

    await refreshHistory(now);
    const snapshots = await getCryptoSnapshots('paper', SYMBOLS);
    let s = state();
    if (!s.startedAt) s = await save({ ...s, startedAt: now.toISOString() }, true);

    for (const symbol of Object.keys(s.positions || {})) {
      const snap = snapshots?.[symbol] || snapshots?.[compact(symbol)];
      if (snap) await checkExit(s, symbol, snap, now);
      s = state();
    }

    const btcBars15m = runtime.bars15m['BTC/USD'] || [];
    const candidates = [];
    const nearMisses = [];

    for (const symbol of TARGETS) {
      if (s.positions?.[symbol]) continue;
      const result = evaluateCryptoCandidateC62({
        asset: { symbol },
        bars15m: runtime.bars15m[symbol] || [],
        btcBars15m,
        now: now.getTime(),
      });

      if (result.signal) {
        runtime.qualifications += 1;
        candidates.push(result.signal);
      } else {
        nearMisses.push({ symbol, reason: result.reason || 'rejected' });
      }
    }

    runtime.scans += 1;
    for (const signal of candidates) {
      s = state();
      await enter(s, signal, now);
    }

    s = state();
    await save(s, false);
    runtime.lastDecision = candidates.length
      ? `C62 shadow qualified ${candidates.length}; ${Object.keys(s.positions || {}).length} open, ${(s.closedTrades || []).length} closed`
      : `C62 shadow scanned ETH/SOL/LINK; no new setup; ${Object.keys(s.positions || {}).length} open`;

    runtime.nearMisses = nearMisses;
  } catch (error) {
    runtime.lastError = error.message;
    runtime.lastDecision = `C62 shadow error: ${error.message}`;
    console.error('[c62-shadow]', error);
  } finally {
    runtime.busy = false;
    schedule();
  }
}

function schedule() {
  if (!runtime.running) return;
  runtime.timer = setTimeout(tick, POLL_MS);
  runtime.timer.unref?.();
}

export function startC62Shadow() {
  if (runtime.running) return;
  runtime.running = true;
  runtime.lastDecision = 'C62 paper-shadow starting';
  setTimeout(tick, 3000).unref?.();
}

function status() {
  const s = state();
  return {
    running: runtime.running,
    mode: 'paper-shadow',
    placesOrders: false,
    strategy: 'CRYPTO_C62_LEAD_LAG_SHADOW',
    symbols: SYMBOLS,
    targets: TARGETS,
    rules: {
      timeframe: '15Min',
      direction: 'long-only',
      btcLookbackBars: 8,
      btcImpulseMinPct: 0.6,
      btcAtr14MinPct: 0.4,
      structureBars: 64,
      assetReactionMaxFractionOfBtc: 0.5,
      stopAtr: 2.5,
      targetR: 3.25,
      roundTripCostPct: 1,
      maxHoldMinutes: 1440,
      trailTriggerR: 2.5,
      trailDistanceR: 1.5,
      initialWeight: 0.5,
      scaleInAtR: 1,
    },
    lastTickAt: runtime.lastTickAt,
    lastDecision: runtime.lastDecision,
    lastError: runtime.lastError,
    nearMisses: runtime.nearMisses || [],
    performance: summary(s),
    ...s,
  };
}

router.get('/status', (req, res) => res.json(status()));
router.post('/start', (req, res) => {
  startC62Shadow();
  res.json(status());
});
router.post('/stop', (req, res) => {
  if (runtime.timer) clearTimeout(runtime.timer);
  runtime.timer = null;
  runtime.running = false;
  runtime.lastDecision = 'C62 shadow stopped';
  res.json(status());
});
router.post('/tick', async (req, res) => {
  if (!runtime.running) startC62Shadow();
  await tick();
  res.json(status());
});

export default router;
