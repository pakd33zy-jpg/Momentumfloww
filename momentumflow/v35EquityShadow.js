// V35 EQUITY LIVE-MARKET SHADOW/PAPER TESTER
// Rotating-universe forward validator. No broker-order path is imported.
// Hard prefilters are intentionally minimal: invalid/untradeable data only.

import {
  getStockSnapshots,
  getStockBars,
  getMarketNews,
  getTradableAssets,
} from './alpacaClient.js';
import { buildEquityMarketRegime } from './strategyEngine.js';
import { evaluateEquityCandidateV35 } from './equityStrategyV35.js';
import { buildNewsIntelligenceMapV34 } from './marketIntelligenceV34.js';

const CORE_SYMBOLS = (process.env.V35_EQUITY_CORE_SYMBOLS ||
  'SPY,QQQ,IWM,DIA,AAPL,MSFT,NVDA,AMZN,META,GOOGL,TSLA,AMD,AVGO,PLTR,COIN,MSTR,SOFI,INTC,MU,SMCI,RIVN,NIO,LCID,MARA,RIOT,HOOD,UBER,CRM,ORCL,NFLX,F,SNAP,BAC,CCL,AAL')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

const POLL_MS = Math.max(30000, Number(process.env.V35_EQUITY_SHADOW_POLL_MS || 60000));
const STARTING_EQUITY = Math.max(1000, Number(process.env.V35_EQUITY_SHADOW_EQUITY || 100000));
const RISK_FRACTION = Math.min(0.01, Math.max(0.001, Number(process.env.V35_EQUITY_SHADOW_RISK || 0.01)));
const MAX_POSITIONS = Math.max(1, Math.min(20, Number(process.env.V35_EQUITY_SHADOW_MAX_POSITIONS || 8)));
const MIN_SCORE = Math.max(0, Math.min(10, Number(process.env.V35_EQUITY_SHADOW_MIN_SCORE || 6.5)));
const CONFIRM_SCANS = Math.max(1, Math.min(5, Number(process.env.V35_CONFIRM_SCANS || 1)));
const ROTATING_BATCH_SIZE = Math.max(100, Math.min(1200, Number(process.env.V35_EQUITY_ROTATING_BATCH_SIZE || 500)));
const DETAIL_LIMIT = Math.max(20, Math.min(150, Number(process.env.V35_EQUITY_DETAIL_LIMIT || 80)));
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
let universe = [];
let assetsFetchedAt = 0;
let equityCursor = 0;
const positions = new Map();
const closed = [];
const confirmations = new Map();
const lastPrices = new Map();
let scanCount = 0;
let qualificationCount = 0;
let confirmedCount = 0;
let consecutiveLosses = 0;
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
    qualifications: qualificationCount,
    confirmedSetups: confirmedCount,
    universe: universe.length,
    openPositions: positions.size,
    closedTrades: closed.length,
    wins,
    losses,
    winRatePct: closed.length ? Number((wins / closed.length * 100).toFixed(2)) : 0,
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(3)) : grossWin > 0 ? 999 : 0,
    netPnl: Number((paperEquity - STARTING_EQUITY).toFixed(2)),
    consecutiveLosses,
  };
}

function resetSessionState(dateKey) {
  if (!activeSessionDate) activeSessionDate = dateKey;
  if (activeSessionDate === dateKey) return;
  activeSessionDate = dateKey;
  confirmations.clear();
  consecutiveLosses = 0;
  equityCursor = 0;
  console.log('[V35 equity shadow] NEW_SESSION', dateKey);
}

async function refreshAssets() {
  if (Date.now() - assetsFetchedAt < 30 * 60000 && universe.length) return;
  const assets = await getTradableAssets('live');
  const rows = Array.isArray(assets?.equities) ? assets.equities : [];
  assetMap = new Map(rows.map((asset) => [String(asset.symbol || '').toUpperCase(), asset]));
  universe = [...assetMap.keys()];
  assetsFetchedAt = Date.now();
  if (equityCursor >= universe.length) equityCursor = 0;
  console.log('[V35 equity shadow] UNIVERSE', JSON.stringify({ equities: universe.length }));
}

async function refreshNews(now, symbols) {
  if (Date.now() - newsFetchedAt < 5 * 60000) return;
  try {
    const response = await getMarketNews('live', {
      symbols,
      start: new Date(now.getTime() - 24 * 3600000),
      end: now,
      limit: 50,
      includeContent: false,
    });
    const articles = Array.isArray(response?.news) ? response.news : Array.isArray(response?.articles) ? response.articles : [];
    newsMap = buildNewsIntelligenceMapV34({ articles, now });
    newsFetchedAt = Date.now();
  } catch (error) {
    newsFetchedAt = Date.now();
    console.warn('[V35 equity shadow] news unavailable:', error.message);
  }
}

function snapshotScore(snapshot) {
  const trade = n(snapshot?.latestTrade?.p ?? snapshot?.minuteBar?.c ?? snapshot?.dailyBar?.c);
  if (!(trade > 0)) return -Infinity;
  const minuteOpen = n(snapshot?.minuteBar?.o, trade);
  const minuteMove = minuteOpen > 0 ? Math.abs((trade / minuteOpen - 1) * 100) : 0;
  const prev = n(snapshot?.prevDailyBar?.c);
  const dayMove = prev > 0 ? Math.abs((trade / prev - 1) * 100) : 0;
  const vol = Math.max(0, n(snapshot?.dailyBar?.v, 0));
  const dollarVolume = trade * vol;
  const bid = n(snapshot?.latestQuote?.bp);
  const ask = n(snapshot?.latestQuote?.ap);
  const spread = bid > 0 && ask > 0 ? (ask - bid) / ((ask + bid) / 2) * 100 : 0.25;
  return minuteMove * 4 + dayMove * 0.35 + Math.log10(dollarVolume + 10) * 0.15 - spread * 2;
}

function rotatingSymbols() {
  if (!universe.length) return [...new Set(CORE_SYMBOLS)];
  const count = Math.min(ROTATING_BATCH_SIZE, universe.length);
  const batch = [];
  for (let i = 0; i < count; i += 1) {
    batch.push(universe[(equityCursor + i) % universe.length]);
  }
  equityCursor = (equityCursor + count) % universe.length;
  return [...new Set([...CORE_SYMBOLS, ...positions.keys(), ...batch, 'SPY', 'QQQ'])];
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
  if (pnl < 0) consecutiveLosses += 1;
  else if (pnl > 0) consecutiveLosses = 0;
  console.log('[V35 equity shadow] EXIT', JSON.stringify(trade));
  return true;
}

function checkExit(symbol, snapshot, now) {
  const p = positions.get(symbol);
  if (!p) return false;
  const bar = snapshot?.minuteBar || {};
  const latest = n(snapshot?.latestTrade?.p ?? bar?.c);
  const high = n(bar?.h, latest);
  const low = n(bar?.l, latest);
  if (!(latest > 0)) return false;
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
  if (exit) return closePosition(symbol, exit, reason, now);
  return false;
}

function enter(signal, now) {
  if (!signal || positions.has(signal.symbol) || positions.size >= MAX_POSITIONS) return false;
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
  console.log('[V35 equity shadow] ENTER', JSON.stringify({ ...p, openedAt: now.toISOString(), notional: Number(notional.toFixed(2)) }));
  return true;
}

function updateConfirmation(signal, now) {
  const prior = confirmations.get(signal.symbol);
  const closeEnough = prior && prior.direction === signal.direction && now.getTime() - prior.lastSeen <= POLL_MS * 2.5;
  const count = closeEnough ? prior.count + 1 : 1;
  confirmations.set(signal.symbol, { direction: signal.direction, count, lastSeen: now.getTime() });
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
      for (const symbol of [...positions.keys()]) {
        const latest = n(lastPrices.get(symbol));
        if (latest > 0) closePosition(symbol, latest, 'SESSION_CLOSE_LAST_PRICE', now);
      }
    }
  }
  console.log('[V35 equity shadow] FINAL_DAILY', JSON.stringify({ at: now.toISOString(), summary: summary(), closed: closed.slice(-200) }));
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

  await refreshAssets();
  const batchSymbols = rotatingSymbols();
  await refreshNews(now, batchSymbols);
  const snapshots = await getStockSnapshots('live', batchSymbols, { feed: 'iex' });
  scanCount += 1;

  const exitedThisScan = new Set();
  for (const symbol of [...positions.keys()]) {
    if (snapshots[symbol] && checkExit(symbol, snapshots[symbol], now)) exitedThisScan.add(symbol);
  }

  const ranked = batchSymbols
    .filter((symbol) => !positions.has(symbol) && !exitedThisScan.has(symbol) && snapshots[symbol])
    .map((symbol) => ({ symbol, score: snapshotScore(snapshots[symbol]) }))
    .filter((x) => Number.isFinite(x.score))
    .sort((a, b) => b.score - a.score);

  const detailSymbols = [...new Set([
    ...ranked.slice(0, DETAIL_LIMIT).map((x) => x.symbol),
    'SPY', 'QQQ',
  ])];

  const start = new Date(now.getTime() - 12 * 3600000);
  const bars = await getStockBars('live', detailSymbols, {
    timeframe: '1Min', start, end: now, limit: 10000, feed: 'iex', maxPages: 4,
  });
  const marketRegime = buildEquityMarketRegime(bars.SPY || [], bars.QQQ || []);

  const candidates = [];
  const rejectCounts = new Map();
  const seenThisScan = new Set();

  for (const symbol of ranked.slice(0, DETAIL_LIMIT).map((x) => x.symbol)) {
    const snapshot = snapshots[symbol];
    const rows = bars[symbol] || [];
    if (!snapshot || rows.length < 12) {
      rejectCounts.set('insufficient detailed market data', (rejectCounts.get('insufficient detailed market data') || 0) + 1);
      continue;
    }
    const asset = assetMap.get(symbol) || { symbol, shortable: false, easy_to_borrow: false };
    const intel = newsMap[compact(symbol)] || null;
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
      qualificationCount += 1;
      result.signal.intelligence = intel;
      const confirmationCount = updateConfirmation(result.signal, now);
      seenThisScan.add(symbol);
      candidates.push({ ...result.signal, confirmationCount });
    } else {
      const reason = result?.reason || result?.diagnostics?.reason || 'V35: rejected';
      rejectCounts.set(reason, (rejectCounts.get(reason) || 0) + 1);
    }
  }

  for (const [symbol, value] of confirmations.entries()) {
    if (!seenThisScan.has(symbol) && now.getTime() - value.lastSeen > POLL_MS * 2.5) confirmations.delete(symbol);
  }

  candidates.sort((a, b) => Number(b.score) - Number(a.score));
  const confirmed = candidates.filter((x) => x.confirmationCount >= CONFIRM_SCANS);
  confirmedCount += confirmed.length;
  const slots = Math.max(0, MAX_POSITIONS - positions.size);
  for (const signal of confirmed.slice(0, slots)) enter(signal, now);

  const topRejects = [...rejectCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([reason, count]) => ({ reason, count }));

  console.log('[V35 equity shadow] SCAN', JSON.stringify({
    at: now.toISOString(),
    marketRegime,
    batchScanned: batchSymbols.length,
    detailed: Math.min(DETAIL_LIMIT, ranked.length),
    qualified: candidates.length,
    confirmed: confirmed.length,
    top: candidates.slice(0, 8).map((x) => ({ symbol: x.symbol, direction: x.direction, score: x.score, confirmationCount: x.confirmationCount, playbook: x.signal?.playbook, regimeAligned: x.signal?.regimeAligned, trendAligned: x.signal?.trendAligned })),
    topRejects,
    summary: summary(),
  }));

  return { session, candidates: candidates.length, confirmed: confirmed.length };
}

console.log('[V35 equity shadow] starting', JSON.stringify({
  coreSymbols: CORE_SYMBOLS.length,
  startingEquity: STARTING_EQUITY,
  riskFraction: RISK_FRACTION,
  maxPositions: MAX_POSITIONS,
  minScore: MIN_SCORE,
  confirmScans: CONFIRM_SCANS,
  rotatingBatchSize: ROTATING_BATCH_SIZE,
  detailLimit: DETAIL_LIMIT,
  firstSignalMinuteET: FIRST_SIGNAL_MINUTE_ET,
  pollMs: POLL_MS,
  orderPlacement: false,
  lossStreakAutoPause: false,
}));

while (true) {
  try {
    await scanOnce();
  } catch (error) {
    console.error('[V35 equity shadow] scan error:', error?.stack || error?.message || error);
  }
  await sleep(POLL_MS);
}