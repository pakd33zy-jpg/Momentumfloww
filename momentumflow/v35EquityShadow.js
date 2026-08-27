// V35 EQUITY LIVE-MARKET SHADOW/PAPER TESTER
// Market-data-driven forward validator. No live-money order path is imported.

import {
  getStockSnapshots,
  getStockBars,
  getMarketNews,
  getTradableAssets,
} from './alpacaClient.js';
import { buildEquityMarketRegime } from './strategyEngine.js';
import { evaluateEquityCandidateV35 } from './equityStrategyV35.js';
import { buildNewsIntelligenceMapV34 } from './marketIntelligenceV34.js';

const SYMBOLS = (process.env.V35_EQUITY_SHADOW_SYMBOLS || process.env.V34_EQUITY_SHADOW_SYMBOLS ||
  'SPY,QQQ,IWM,DIA,AAPL,MSFT,NVDA,AMZN,META,GOOGL,TSLA,AMD,AVGO,PLTR,COIN,MSTR,SOFI,INTC,MU,SMCI,RIVN,NIO,LCID,MARA,RIOT,HOOD,UBER,CRM,ORCL,NFLX,F,SNAP,BAC,CCL,AAL')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

const POLL_MS = Math.max(30000, Number(process.env.V35_EQUITY_SHADOW_POLL_MS || process.env.V34_EQUITY_SHADOW_POLL_MS || 60000));
const STARTING_EQUITY = Math.max(1000, Number(process.env.V35_EQUITY_SHADOW_EQUITY || process.env.V34_EQUITY_SHADOW_EQUITY || 100000));
const RISK_FRACTION = Math.min(0.01, Math.max(0.001, Number(process.env.V35_EQUITY_SHADOW_RISK || process.env.V34_EQUITY_SHADOW_RISK || 0.003)));
const MAX_POSITIONS = Math.max(1, Math.min(8, Number(process.env.V35_EQUITY_SHADOW_MAX_POSITIONS || process.env.V34_EQUITY_SHADOW_MAX_POSITIONS || 3)));
const MIN_SCORE = Math.max(5, Math.min(10, Number(process.env.V35_EQUITY_SHADOW_MIN_SCORE || process.env.V34_EQUITY_SHADOW_MIN_SCORE || 8.5)));
const CONFIRM_SCANS = Math.max(1, Math.min(5, Number(process.env.V35_CONFIRM_SCANS || 2)));
const MAX_CONSECUTIVE_LOSSES = Math.max(1, Math.min(10, Number(process.env.V35_MAX_CONSECUTIVE_LOSSES || 3)));
const LOSS_PAUSE_MS = Math.max(5, Number(process.env.V35_LOSS_PAUSE_MINUTES || 30)) * 60000;
const FIRST_SIGNAL_MINUTE_ET = Math.max(570, Number(process.env.V35_FIRST_SIGNAL_MINUTE_ET || (9 * 60 + 35)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const n = (v, f = NaN) => Number.isFinite(Number(v)) ? Number(v) : f;
const compact = (s) => String(s || '').replace('/', '').toUpperCase();

const ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function etNow(date = new Date()) {
  const p = Object.fromEntries(ET.formatToParts(date).map((x) => [x.type, x.value]));
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  const dateKey = `${p.year}-${p.month}-${p.day}`;
  return { weekday: p.weekday, minutes, dateKey };
}
function regularSessionState(date = new Date()) {
  const { weekday, minutes } = etNow(date);
  const weekdayOpen = ['Mon','Tue','Wed','Thu','Fri'].includes(weekday);
  if (!weekdayOpen) return 'closed';
  if (minutes < 570) return 'pre';
  if (minutes < 960) return 'regular';
  return 'closed';
}

let paperEquity = STARTING_EQUITY;
let peakEquity = STARTING_EQUITY;
let maxDrawdownPct = 0;
let newsMap = {};
let newsFetchedAt = 0;
let assetMap = new Map();
let assetsFetchedAt = 0;
const positions = new Map();
const closed = [];
const confirmations = new Map();
const tradedSymbols = new Set();
const lastPrices = new Map();
let scanCount = 0;
let qualifiedCount = 0;
let confirmedCount = 0;
let consecutiveLosses = 0;
let pauseUntil = 0;
let activeSessionDate = null;
let lastFinalDate = null;

function updateDrawdown() {
  peakEquity = Math.max(peakEquity, paperEquity);
  if (peakEquity > 0) {
    maxDrawdownPct = Math.max(maxDrawdownPct, ((peakEquity - paperEquity) / peakEquity) * 100);
  }
}

function summary() {
  const wins = closed.filter((x) => x.pnl > 0).length;
  const losses = closed.filter((x) => x.pnl < 0).length;
  const grossWin = closed.filter((x) => x.pnl > 0).reduce((a, x) => a + x.pnl, 0);
  const grossLoss = Math.abs(closed.filter((x) => x.pnl < 0).reduce((a, x) => a + x.pnl, 0));
  return {
    strategy: 'V35',
    startingEquity: STARTING_EQUITY,
    paperEquity: Number(paperEquity.toFixed(2)),
    returnPct: Number(((paperEquity / STARTING_EQUITY - 1) * 100).toFixed(3)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(3)),
    scans: scanCount,
    qualifications: qualifiedCount,
    confirmedSetups: confirmedCount,
    openPositions: positions.size,
    closedTrades: closed.length,
    wins,
    losses,
    winRatePct: closed.length ? Number((wins / closed.length * 100).toFixed(2)) : 0,
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(3)) : grossWin > 0 ? 999 : 0,
    netPnl: Number((paperEquity - STARTING_EQUITY).toFixed(2)),
    consecutiveLosses,
    paused: Date.now() < pauseUntil,
  };
}

function resetSessionState(dateKey) {
  if (!activeSessionDate) activeSessionDate = dateKey;
  if (activeSessionDate === dateKey) return;
  activeSessionDate = dateKey;
  tradedSymbols.clear();
  confirmations.clear();
  consecutiveLosses = 0;
  pauseUntil = 0;
  console.log('[V35 equity shadow] NEW_SESSION', dateKey);
}

async function refreshAssets() {
  if (Date.now() - assetsFetchedAt < 30 * 60000 && assetMap.size) return;
  try {
    const assets = await getTradableAssets('live');
    assetMap = new Map(
      (assets?.equities || [])
        .filter((asset) => SYMBOLS.includes(String(asset?.symbol || '').toUpperCase()))
        .map((asset) => [String(asset.symbol).toUpperCase(), asset])
    );
    assetsFetchedAt = Date.now();
    console.log(`[V35 equity shadow] asset metadata refresh: ${assetMap.size}/${SYMBOLS.length}`);
  } catch (error) {
    assetsFetchedAt = Date.now();
    console.warn(`[V35 equity shadow] asset metadata unavailable: ${error.message}`);
  }
}

async function refreshNews(now) {
  if (Date.now() - newsFetchedAt < 5 * 60000) return;
  try {
    const response = await getMarketNews('live', {
      symbols: SYMBOLS,
      start: new Date(now.getTime() - 24 * 3600000),
      end: now,
      limit: 50,
      includeContent: false,
    });
    const articles = Array.isArray(response?.news) ? response.news : Array.isArray(response?.articles) ? response.articles : [];
    newsMap = buildNewsIntelligenceMapV34({ articles, now });
    newsFetchedAt = Date.now();
    console.log(`[V35 equity shadow] news refresh: ${articles.length} articles, ${Object.keys(newsMap).length} symbol maps`);
  } catch (error) {
    newsFetchedAt = Date.now();
    console.warn(`[V35 equity shadow] news unavailable: ${error.message}`);
  }
}

function closePosition(symbol, exit, reason, now) {
  const p = positions.get(symbol);
  if (!p || !(exit > 0)) return false;

  const grossPct = p.direction === 'LONG'
    ? ((exit / p.entry) - 1) * 100
    : ((p.entry / exit) - 1) * 100;
  const netPct = grossPct - p.costPct;
  const pnl = p.notional * netPct / 100;
  paperEquity += pnl;
  updateDrawdown();

  const trade = {
    symbol,
    direction: p.direction,
    strategy: p.strategy,
    playbook: p.playbook,
    entry: p.entry,
    exit,
    netPct: Number(netPct.toFixed(4)),
    pnl: Number(pnl.toFixed(2)),
    score: p.score,
    reason,
    openedAt: new Date(p.openedAt).toISOString(),
    closedAt: now.toISOString(),
  };

  closed.push(trade);
  positions.delete(symbol);

  if (pnl < 0) {
    consecutiveLosses += 1;
    if (consecutiveLosses >= MAX_CONSECUTIVE_LOSSES) {
      pauseUntil = Math.max(pauseUntil, now.getTime() + LOSS_PAUSE_MS);
      console.warn('[V35 equity shadow] LOSS_STREAK_PAUSE', JSON.stringify({
        consecutiveLosses,
        pauseUntil: new Date(pauseUntil).toISOString(),
      }));
    }
  } else if (pnl > 0) {
    consecutiveLosses = 0;
  }

  console.log('[V35 equity shadow] EXIT', JSON.stringify(trade));
  return true;
}

function checkExit(symbol, snapshot, now) {
  const p = positions.get(symbol);
  if (!p) return;
  const bar = snapshot?.minuteBar || {};
  const latest = n(snapshot?.latestTrade?.p ?? bar?.c);
  const high = n(bar?.h, latest);
  const low = n(bar?.l, latest);
  if (!(latest > 0)) return;
  lastPrices.set(symbol, latest);

  let exit = null;
  let reason = null;
  if (p.direction === 'LONG') {
    const stopHit = low <= p.stopPrice;
    const targetHit = high >= p.targetPrice;
    if (stopHit) { exit = p.stopPrice; reason = targetHit ? 'STOP_SAME_BAR' : 'STOP'; }
    else if (targetHit) { exit = p.targetPrice; reason = 'TARGET'; }
  } else {
    const stopHit = high >= p.stopPrice;
    const targetHit = low <= p.targetPrice;
    if (stopHit) { exit = p.stopPrice; reason = targetHit ? 'STOP_SAME_BAR' : 'STOP'; }
    else if (targetHit) { exit = p.targetPrice; reason = 'TARGET'; }
  }

  if (!exit && now.getTime() - p.openedAt >= p.maxHoldMinutes * 60000) {
    exit = latest;
    reason = 'MAX_HOLD';
  }
  if (exit) closePosition(symbol, exit, reason, now);
}

function enter(signal, now) {
  if (!signal || positions.has(signal.symbol) || tradedSymbols.has(signal.symbol)) return false;
  if (positions.size >= MAX_POSITIONS || now.getTime() < pauseUntil) return false;
  const plan = signal.signal?.exitPlan || {};
  const stopPct = n(plan.stopLossPct);
  const targetPct = n(plan.takeProfitPct);
  const entry = n(signal.price);
  if (!(stopPct > 0) || !(targetPct > 0) || !(entry > 0)) return false;

  const riskDollars = paperEquity * RISK_FRACTION;
  const notional = Math.min(paperEquity * 0.20, riskDollars / (stopPct / 100));
  if (!(notional > 0)) return false;

  const direction = signal.direction;
  const stopPrice = direction === 'LONG' ? entry * (1 - stopPct / 100) : entry * (1 + stopPct / 100);
  const targetPrice = direction === 'LONG' ? entry * (1 + targetPct / 100) : entry * (1 - targetPct / 100);
  const p = {
    symbol: signal.symbol,
    direction,
    strategy: signal.strategy,
    playbook: signal.signal?.playbook,
    score: signal.score,
    entry,
    stopPrice,
    targetPrice,
    notional,
    costPct: n(plan.estimatedRoundTripCostPct, 0.04),
    maxHoldMinutes: Math.max(5, n(plan.maxHoldMinutes, 45)),
    openedAt: now.getTime(),
  };

  positions.set(signal.symbol, p);
  tradedSymbols.add(signal.symbol);
  console.log('[V35 equity shadow] ENTER', JSON.stringify({
    ...p,
    openedAt: now.toISOString(),
    notional: Number(notional.toFixed(2)),
  }));
  return true;
}

function updateConfirmation(signal, now) {
  const key = signal.symbol;
  const prior = confirmations.get(key);
  const closeEnough = prior &&
    prior.direction === signal.direction &&
    now.getTime() - prior.lastSeen <= POLL_MS * 2.5;
  const count = closeEnough ? prior.count + 1 : 1;
  const next = { direction: signal.direction, count, lastSeen: now.getTime() };
  confirmations.set(key, next);
  return count;
}

async function finalizeSession(now) {
  if (positions.size) {
    try {
      const snapshots = await getStockSnapshots('live', [...positions.keys()], { feed: 'iex' });
      for (const symbol of [...positions.keys()]) {
        const snapshot = snapshots?.[symbol];
        const latest = n(snapshot?.latestTrade?.p ?? snapshot?.minuteBar?.c, lastPrices.get(symbol));
        if (latest > 0) closePosition(symbol, latest, 'SESSION_CLOSE', now);
      }
    } catch (error) {
      console.warn('[V35 equity shadow] close snapshot unavailable:', error.message);
      for (const symbol of [...positions.keys()]) {
        const latest = n(lastPrices.get(symbol));
        if (latest > 0) closePosition(symbol, latest, 'SESSION_CLOSE_LAST_PRICE', now);
      }
    }
  }

  console.log('[V35 equity shadow] FINAL_DAILY', JSON.stringify({
    at: now.toISOString(),
    summary: summary(),
    closed: closed.slice(-100),
  }));
}

async function scanOnce() {
  const now = new Date();
  const et = etNow(now);
  resetSessionState(et.dateKey);
  const session = regularSessionState(now);

  if (session === 'closed') {
    if (lastFinalDate !== et.dateKey) {
      await finalizeSession(now);
      lastFinalDate = et.dateKey;
    }
    return { session };
  }
  if (session !== 'regular') return { session };
  if (et.minutes < FIRST_SIGNAL_MINUTE_ET) return { session: 'opening-warmup' };

  await Promise.all([refreshAssets(), refreshNews(now)]);
  const start = new Date(now.getTime() - 12 * 3600000);
  const [snapshots, bars] = await Promise.all([
    getStockSnapshots('live', SYMBOLS, { feed: 'iex' }),
    getStockBars('live', SYMBOLS, { timeframe: '1Min', start, end: now, limit: 10000, feed: 'iex', maxPages: 3 }),
  ]);
  scanCount += 1;

  const marketRegime = buildEquityMarketRegime(bars.SPY || [], bars.QQQ || []);
  for (const symbol of SYMBOLS) {
    const latest = n(snapshots?.[symbol]?.latestTrade?.p ?? snapshots?.[symbol]?.minuteBar?.c);
    if (latest > 0) lastPrices.set(symbol, latest);
    checkExit(symbol, snapshots[symbol], now);
  }

  const candidates = [];
  const rejectCounts = new Map();
  const seenThisScan = new Set();

  for (const symbol of SYMBOLS) {
    if (positions.has(symbol) || tradedSymbols.has(symbol)) continue;
    const snapshot = snapshots[symbol];
    const rows = bars[symbol] || [];
    if (!snapshot || rows.length < 31) continue;
    const intel = newsMap[compact(symbol)] || null;
    const asset = assetMap.get(symbol) || { symbol, shortable: false, easy_to_borrow: false };
    const result = evaluateEquityCandidateV35({
      asset,
      snapshot,
      bars: rows,
      marketRegime,
      intelligence: intel,
      now,
      mode: 'paper-shadow',
      config: { equityV35ScoreThreshold: MIN_SCORE },
    });

    if (result.signal) {
      qualifiedCount += 1;
      result.signal.intelligence = intel;
      const confirmationCount = updateConfirmation(result.signal, now);
      seenThisScan.add(symbol);
      candidates.push({ ...result.signal, confirmationCount });
    } else {
      const reason = result?.reason || 'V35: rejected';
      rejectCounts.set(reason, (rejectCounts.get(reason) || 0) + 1);
    }
  }

  for (const [symbol, value] of confirmations.entries()) {
    if (!seenThisScan.has(symbol) && now.getTime() - value.lastSeen > POLL_MS * 2.5) {
      confirmations.delete(symbol);
    }
  }

  candidates.sort((a, b) => Number(b.score) - Number(a.score));
  const confirmed = candidates.filter((x) => x.confirmationCount >= CONFIRM_SCANS);
  confirmedCount += confirmed.length;

  const slots = Math.max(0, MAX_POSITIONS - positions.size);
  if (Date.now() >= pauseUntil && slots > 0) {
    for (const signal of confirmed.slice(0, slots)) enter(signal, now);
  }

  const topRejects = [...rejectCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

  if (scanCount % 10 === 0 || candidates.length || topRejects.length) {
    console.log('[V35 equity shadow] SCAN', JSON.stringify({
      at: now.toISOString(),
      marketRegime,
      qualified: candidates.length,
      confirmed: confirmed.length,
      top: candidates.slice(0, 5).map((x) => ({
        symbol: x.symbol,
        direction: x.direction,
        score: x.score,
        confirmationCount: x.confirmationCount,
        playbook: x.signal?.playbook,
        evidence: x.signal?.evidence?.slice(-6),
      })),
      topRejects,
      summary: summary(),
    }));
  }

  return { session, candidates: candidates.length, confirmed: confirmed.length };
}

console.log('[V35 equity shadow] starting', JSON.stringify({
  symbols: SYMBOLS.length,
  startingEquity: STARTING_EQUITY,
  riskFraction: RISK_FRACTION,
  maxPositions: MAX_POSITIONS,
  minScore: MIN_SCORE,
  confirmScans: CONFIRM_SCANS,
  maxConsecutiveLosses: MAX_CONSECUTIVE_LOSSES,
  lossPauseMinutes: LOSS_PAUSE_MS / 60000,
  firstSignalMinuteET: FIRST_SIGNAL_MINUTE_ET,
  pollMs: POLL_MS,
  orderPlacement: false,
}));

while (true) {
  try {
    await scanOnce();
  } catch (error) {
    console.error('[V35 equity shadow] scan error:', error?.stack || error?.message || error);
  }
  await sleep(POLL_MS);
}
