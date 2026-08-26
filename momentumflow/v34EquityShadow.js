// V34 EQUITY LIVE-MARKET SHADOW PAPER TESTER
// Reads Alpaca market data only. It never imports or calls placeOrder.
// Simulates entries/exits and risk in memory for forward validation.

import {
  getStockSnapshots,
  getStockBars,
  getMarketNews,
  getTradableAssets,
} from './alpacaClient.js';
import { buildEquityMarketRegime } from './strategyEngine.js';
import { evaluateEquityCandidateV34 } from './equityStrategyV34.js';
import { buildNewsIntelligenceMapV34 } from './marketIntelligenceV34.js';

const SYMBOLS = (process.env.V34_EQUITY_SHADOW_SYMBOLS ||
  'SPY,QQQ,IWM,DIA,AAPL,MSFT,NVDA,AMZN,META,GOOGL,TSLA,AMD,AVGO,PLTR,COIN,MSTR,SOFI,INTC,MU,SMCI,RIVN,NIO,LCID,MARA,RIOT,HOOD,UBER,CRM,ORCL,NFLX,F,SNAP,BAC,CCL,AAL')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

const POLL_MS = Math.max(30000, Number(process.env.V34_EQUITY_SHADOW_POLL_MS || 60000));
const STARTING_EQUITY = Math.max(1000, Number(process.env.V34_EQUITY_SHADOW_EQUITY || 100000));
const RISK_FRACTION = Math.min(0.01, Math.max(0.001, Number(process.env.V34_EQUITY_SHADOW_RISK || 0.005)));
const MAX_POSITIONS = Math.max(1, Math.min(8, Number(process.env.V34_EQUITY_SHADOW_MAX_POSITIONS || 5)));
const MIN_SCORE = Math.max(5, Math.min(9, Number(process.env.V34_EQUITY_SHADOW_MIN_SCORE || 6.3)));
const COOLDOWN_MS = 15 * 60000;
const FIRST_SIGNAL_MINUTE_ET = 9 * 60 + 35;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const n = (v, f = NaN) => Number.isFinite(Number(v)) ? Number(v) : f;
const compact = (s) => String(s || '').replace('/', '').toUpperCase();

const ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function etNow(date = new Date()) {
  const p = Object.fromEntries(ET.formatToParts(date).map((x) => [x.type, x.value]));
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  return { weekday: p.weekday, minutes };
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
let newsMap = {};
let newsFetchedAt = 0;
let assetMap = new Map();
let assetsFetchedAt = 0;
const positions = new Map();
const cooldown = new Map();
const closed = [];
let scanCount = 0;
let qualifiedCount = 0;

function summary() {
  const wins = closed.filter((x) => x.pnl > 0).length;
  const losses = closed.filter((x) => x.pnl < 0).length;
  const grossWin = closed.filter((x) => x.pnl > 0).reduce((a, x) => a + x.pnl, 0);
  const grossLoss = Math.abs(closed.filter((x) => x.pnl < 0).reduce((a, x) => a + x.pnl, 0));
  return {
    startingEquity: STARTING_EQUITY,
    paperEquity: Number(paperEquity.toFixed(2)),
    returnPct: Number(((paperEquity / STARTING_EQUITY - 1) * 100).toFixed(3)),
    scans: scanCount,
    qualifications: qualifiedCount,
    openPositions: positions.size,
    closedTrades: closed.length,
    wins,
    losses,
    winRatePct: closed.length ? Number((wins / closed.length * 100).toFixed(2)) : 0,
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(3)) : grossWin > 0 ? 999 : 0,
    netPnl: Number((paperEquity - STARTING_EQUITY).toFixed(2)),
  };
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
    console.log(`[V34 equity shadow] asset metadata refresh: ${assetMap.size}/${SYMBOLS.length}`);
  } catch (error) {
    assetsFetchedAt = Date.now();
    console.warn(`[V34 equity shadow] asset metadata unavailable: ${error.message}`);
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
    console.log(`[V34 equity shadow] news refresh: ${articles.length} articles, ${Object.keys(newsMap).length} symbol maps`);
  } catch (error) {
    newsFetchedAt = Date.now();
    console.warn(`[V34 equity shadow] news unavailable: ${error.message}`);
  }
}

function checkExit(symbol, snapshot, now) {
  const p = positions.get(symbol);
  if (!p) return;
  const bar = snapshot?.minuteBar || {};
  const latest = n(snapshot?.latestTrade?.p ?? bar?.c);
  const high = n(bar?.h, latest);
  const low = n(bar?.l, latest);
  if (!(latest > 0)) return;

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
  if (!exit) return;

  const grossPct = p.direction === 'LONG'
    ? ((exit / p.entry) - 1) * 100
    : ((p.entry / exit) - 1) * 100;
  const netPct = grossPct - p.costPct;
  const pnl = p.notional * netPct / 100;
  paperEquity += pnl;
  const trade = {
    symbol, direction: p.direction, strategy: p.strategy, playbook: p.playbook,
    entry: p.entry, exit, netPct: Number(netPct.toFixed(4)), pnl: Number(pnl.toFixed(2)),
    score: p.score, reason, openedAt: new Date(p.openedAt).toISOString(), closedAt: now.toISOString(),
  };
  closed.push(trade);
  positions.delete(symbol);
  cooldown.set(symbol, now.getTime() + COOLDOWN_MS);
  console.log('[V34 equity shadow] EXIT', JSON.stringify(trade));
}

function enter(signal, now) {
  if (!signal || positions.has(signal.symbol) || positions.size >= MAX_POSITIONS) return false;
  if (n(cooldown.get(signal.symbol), 0) > now.getTime()) return false;
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
  console.log('[V34 equity shadow] ENTER', JSON.stringify({ ...p, openedAt: now.toISOString(), notional: Number(notional.toFixed(2)) }));
  return true;
}

async function scanOnce() {
  const now = new Date();
  const session = regularSessionState(now);
  if (session !== 'regular') return { session };

  const et = etNow(now);
  if (et.minutes < FIRST_SIGNAL_MINUTE_ET) return { session: 'opening-warmup' };

  await Promise.all([refreshAssets(), refreshNews(now)]);
  const start = new Date(now.getTime() - 12 * 3600000);
  const [snapshots, bars] = await Promise.all([
    getStockSnapshots('live', SYMBOLS, { feed: 'iex' }),
    getStockBars('live', SYMBOLS, { timeframe: '1Min', start, end: now, limit: 10000, feed: 'iex', maxPages: 3 }),
  ]);
  scanCount += 1;

  const marketRegime = buildEquityMarketRegime(bars.SPY || [], bars.QQQ || []);
  for (const symbol of SYMBOLS) checkExit(symbol, snapshots[symbol], now);

  const candidates = [];
  for (const symbol of SYMBOLS) {
    if (positions.has(symbol)) continue;
    const snapshot = snapshots[symbol];
    const rows = bars[symbol] || [];
    if (!snapshot || rows.length < 12) continue;
    const intel = newsMap[compact(symbol)] || null;
    const asset = assetMap.get(symbol) || { symbol, shortable: false, easy_to_borrow: false };
    const result = evaluateEquityCandidateV34({
      asset,
      snapshot,
      bars: rows,
      marketRegime,
      intelligence: intel,
      now,
      mode: 'paper-shadow',
      config: { equityV34ScoreThreshold: MIN_SCORE },
    });
    if (result.signal) {
      qualifiedCount += 1;
      result.signal.intelligence = intel;
      candidates.push(result.signal);
    }
  }

  candidates.sort((a, b) => Number(b.score) - Number(a.score));
  for (const signal of candidates.slice(0, MAX_POSITIONS)) enter(signal, now);

  if (scanCount % 10 === 0 || candidates.length) {
    console.log('[V34 equity shadow] SCAN', JSON.stringify({
      at: now.toISOString(), marketRegime, qualified: candidates.length,
      top: candidates.slice(0, 5).map((x) => ({ symbol: x.symbol, direction: x.direction, score: x.score, playbook: x.signal?.playbook, evidence: x.signal?.evidence?.slice(0, 4) })),
      summary: summary(),
    }));
  }
  return { session, candidates: candidates.length };
}

console.log('[V34 equity shadow] starting', JSON.stringify({
  symbols: SYMBOLS.length,
  startingEquity: STARTING_EQUITY,
  riskFraction: RISK_FRACTION,
  maxPositions: MAX_POSITIONS,
  minScore: MIN_SCORE,
  firstSignalMinuteET: FIRST_SIGNAL_MINUTE_ET,
  pollMs: POLL_MS,
  orderPlacement: false,
}));

while (true) {
  try {
    const result = await scanOnce();
    if (result.session === 'closed') {
      console.log('[V34 equity shadow] FINAL', JSON.stringify({ summary: summary(), closed: closed.slice(-100) }));
      process.exit(0);
    }
  } catch (error) {
    console.error('[V34 equity shadow] scan error:', error?.stack || error?.message || error);
  }
  await sleep(POLL_MS);
}
