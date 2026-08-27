// V35 CRYPTO 24/7 SHADOW/PAPER TESTER
// Uses live market data and an internal paper ledger. No broker-order path imported.

import {
  getCryptoSnapshots,
  getCryptoBars,
  getMarketNews,
  getTradableAssets,
} from './alpacaClient.js';
import {
  CRYPTO_V35_DEFAULTS,
  evaluateCryptoCandidateV35,
  buildCryptoV35Budget,
} from './cryptoStrategyV35.js';
import { buildNewsIntelligenceMapV34 } from './marketIntelligenceV34.js';

const POLL_MS = Math.max(30000, Number(process.env.V35_CRYPTO_SHADOW_POLL_MS || 60000));
const STARTING_EQUITY = Math.max(1000, Number(process.env.V35_CRYPTO_SHADOW_EQUITY || 100000));
const MIN_SCORE = Math.max(0, Math.min(10, Number(process.env.V35_CRYPTO_SHADOW_MIN_SCORE || 5.5)));
const MAX_POSITIONS = Math.max(1, Math.min(20, Number(process.env.V35_CRYPTO_SHADOW_MAX_POSITIONS || 8)));
const RISK_FRACTION = Math.max(0.001, Math.min(0.02, Number(process.env.V35_CRYPTO_SHADOW_RISK || 0.01)));
const MAX_PORTFOLIO_RISK = Math.max(RISK_FRACTION, Math.min(0.20, Number(process.env.V35_CRYPTO_SHADOW_MAX_PORTFOLIO_RISK || 0.08)));
const MAX_TOTAL_EXPOSURE = Math.max(0.10, Math.min(1.0, Number(process.env.V35_CRYPTO_SHADOW_MAX_TOTAL_EXPOSURE || 0.80)));
const MAX_POSITION_FRACTION = Math.max(0.02, Math.min(0.50, Number(process.env.V35_CRYPTO_SHADOW_MAX_POSITION_FRACTION || 0.20)));
const DATA_REFRESH_MS = Math.max(60000, Number(process.env.V35_CRYPTO_HISTORY_REFRESH_MS || 5 * 60000));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const n = (v, fallback = NaN) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const compact = (s) => String(s || '').replace('/', '').toUpperCase();

let paperEquity = STARTING_EQUITY;
let peakEquity = STARTING_EQUITY;
let maxDrawdownPct = 0;
let assetMap = new Map();
let symbols = [];
let lastUniverseRefresh = 0;
let historyFetchedAt = 0;
let bars15m = {};
let bars1h = {};
let bars1d = {};
let newsMap = {};
let newsFetchedAt = 0;
let scanCount = 0;
let qualificationCount = 0;
const positions = new Map();
const closed = [];

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
    strategy: 'CRYPTO_V35',
    startingEquity: STARTING_EQUITY,
    paperEquity: Number(paperEquity.toFixed(2)),
    returnPct: Number(((paperEquity / STARTING_EQUITY - 1) * 100).toFixed(3)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(3)),
    scans: scanCount,
    qualifications: qualificationCount,
    universe: symbols.length,
    openPositions: positions.size,
    closedTrades: closed.length,
    wins,
    losses,
    winRatePct: closed.length ? Number((wins / closed.length * 100).toFixed(2)) : 0,
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(3)) : grossWin > 0 ? 999 : 0,
    netPnl: Number((paperEquity - STARTING_EQUITY).toFixed(2)),
  };
}

async function refreshUniverse() {
  if (symbols.length && Date.now() - lastUniverseRefresh < 30 * 60000) return;
  const assets = await getTradableAssets('live');
  const rows = Array.isArray(assets?.crypto) ? assets.crypto : [];
  assetMap = new Map(rows.map((asset) => [String(asset.symbol || '').toUpperCase(), asset]));
  symbols = [...assetMap.keys()];
  lastUniverseRefresh = Date.now();
  console.log('[V35 crypto shadow] UNIVERSE', JSON.stringify({ symbols: symbols.length }));
}

function chunks(list, size = 4) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function fetchGroupedBars(timeframe, start, end, batchSize = 4) {
  const out = Object.fromEntries(symbols.map((symbol) => [symbol, []]));
  for (const group of chunks(symbols, batchSize)) {
    const part = await getCryptoBars('live', group, {
      timeframe,
      start,
      end,
      limit: 10000,
      maxPages: 4,
    });
    for (const symbol of group) out[symbol] = part?.[symbol] || [];
  }
  return out;
}

async function backfillMissingBars(target, timeframe, start, end, minimumBars) {
  const missing = symbols.filter((symbol) => (target?.[symbol] || []).length < minimumBars);
  for (const symbol of missing) {
    try {
      const part = await getCryptoBars('live', [symbol], {
        timeframe,
        start,
        end,
        limit: 10000,
        maxPages: 4,
      });
      if ((part?.[symbol] || []).length > (target?.[symbol] || []).length) {
        target[symbol] = part[symbol];
      }
    } catch (error) {
      console.warn('[V35 crypto shadow] history backfill failed', symbol, timeframe, error.message);
    }
  }
}

async function refreshHistory(now) {
  if (!symbols.length) return;
  if (historyFetchedAt && Date.now() - historyFetchedAt < DATA_REFRESH_MS) return;

  const start15m = new Date(now.getTime() - 14 * 24 * 60 * 60000);
  const start1h = new Date(now.getTime() - 60 * 24 * 60 * 60000);
  const start1d = new Date(now.getTime() - 220 * 24 * 60 * 60000);

  const [f15, f1h, f1d] = await Promise.all([
    fetchGroupedBars('15Min', start15m, now, 4),
    fetchGroupedBars('1Hour', start1h, now, 4),
    getCryptoBars('live', symbols, {
      timeframe: '1Day',
      start: start1d,
      end: now,
      limit: 10000,
      maxPages: 4,
    }),
  ]);

  await Promise.all([
    backfillMissingBars(f15, '15Min', start15m, now, 32),
    backfillMissingBars(f1h, '1Hour', start1h, now, 40),
  ]);

  bars15m = f15 || {};
  bars1h = f1h || {};
  bars1d = f1d || {};
  historyFetchedAt = Date.now();

  const coverage = {
    symbols: symbols.length,
    with15m: symbols.filter((s) => (bars15m[s] || []).length >= 32).length,
    with1h: symbols.filter((s) => (bars1h[s] || []).length >= 40).length,
    with1d: symbols.filter((s) => (bars1d[s] || []).length >= 28).length,
  };
  console.log('[V35 crypto shadow] HISTORY_REFRESH', JSON.stringify(coverage));
}

async function refreshNews(now) {
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
    console.warn('[V35 crypto shadow] news unavailable:', error.message);
  }
}

function currentExposure() {
  return [...positions.values()].reduce((sum, p) => sum + p.notional, 0);
}

function currentOpenRiskDollars() {
  return [...positions.values()].reduce((sum, p) => sum + p.riskDollars, 0);
}

function closePosition(symbol, exit, reason, now) {
  const p = positions.get(symbol);
  if (!p || !(exit > 0)) return false;
  const grossPct = ((exit / p.entry) - 1) * 100;
  const netPct = grossPct - p.costPct;
  const pnl = p.notional * netPct / 100;
  paperEquity += pnl;
  updateDrawdown();

  const trade = {
    symbol,
    direction: 'LONG',
    strategy: p.strategy,
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
  console.log('[V35 crypto shadow] EXIT', JSON.stringify(trade));
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

  p.peakPrice = Math.max(n(p.peakPrice, p.entry), high, latest);

  let effectiveStop = p.stopPrice;
  const gainFromEntryPct = (p.peakPrice / p.entry - 1) * 100;
  if (gainFromEntryPct >= p.trailTriggerPct) {
    const trailByDistance = p.peakPrice * (1 - p.trailDistancePct / 100);
    const trailFloor = p.entry * (1 + p.trailFloorPct / 100);
    effectiveStop = Math.max(effectiveStop, trailByDistance, trailFloor);
  }

  const stopHit = low <= effectiveStop;
  const targetHit = high >= p.targetPrice;
  if (stopHit) {
    closePosition(symbol, effectiveStop, targetHit ? 'STOP_SAME_BAR' : 'STOP_OR_TRAIL', now);
    return;
  }
  if (targetHit) {
    closePosition(symbol, p.targetPrice, 'TARGET', now);
    return;
  }
  if (now.getTime() - p.openedAt >= p.maxHoldMinutes * 60000) {
    closePosition(symbol, latest, 'MAX_HOLD', now);
  }
}

function enter(signal, now) {
  if (!signal || positions.has(signal.symbol) || positions.size >= MAX_POSITIONS) return false;
  const plan = signal.signal?.exitPlan || {};
  const stopPct = n(plan.stopLossPct);
  const targetPct = n(plan.takeProfitPct);
  const entry = n(signal.price);
  if (!(stopPct > 0) || !(targetPct > 0) || !(entry > 0)) return false;

  const config = {
    ...CRYPTO_V35_DEFAULTS,
    cryptoV35RiskFraction: RISK_FRACTION,
    cryptoV35MaxPortfolioRiskFraction: MAX_PORTFOLIO_RISK,
    cryptoV35MaxPositionFraction: MAX_POSITION_FRACTION,
    cryptoV35MaxTotalExposureFraction: MAX_TOTAL_EXPOSURE,
  };
  const exposure = currentExposure();
  const openRisk = currentOpenRiskDollars();
  const cash = Math.max(0, paperEquity - exposure);
  const notional = buildCryptoV35Budget({
    equity: paperEquity,
    cash,
    currentCryptoExposure: exposure,
    currentOpenRiskDollars: openRisk,
    signal,
    config,
  });
  if (!(notional > 0)) return false;

  const stopPrice = entry * (1 - stopPct / 100);
  const targetPrice = entry * (1 + targetPct / 100);
  const riskDollars = notional * (stopPct + n(plan.estimatedRoundTripCostPct, 0.50)) / 100;
  const p = {
    symbol: signal.symbol,
    strategy: signal.strategy,
    score: signal.score,
    entry,
    stopPrice,
    targetPrice,
    notional,
    riskDollars,
    costPct: n(plan.estimatedRoundTripCostPct, 0.50),
    maxHoldMinutes: Math.max(5, n(plan.maxHoldMinutes, 3 * 24 * 60)),
    trailTriggerPct: Math.max(0, n(plan.trailTriggerPct, stopPct)),
    trailDistancePct: Math.max(0.05, n(plan.trailDistancePct, stopPct * 0.65)),
    trailFloorPct: Math.max(0, n(plan.trailFloorPct, 0)),
    peakPrice: entry,
    openedAt: now.getTime(),
  };
  positions.set(signal.symbol, p);
  console.log('[V35 crypto shadow] ENTER', JSON.stringify({
    ...p,
    openedAt: now.toISOString(),
    notional: Number(notional.toFixed(2)),
    riskDollars: Number(riskDollars.toFixed(2)),
  }));
  return true;
}

async function scanOnce() {
  const now = new Date();
  await refreshUniverse();
  if (!symbols.length) return;
  await Promise.all([refreshHistory(now), refreshNews(now)]);

  const snapshots = await getCryptoSnapshots('live', symbols);
  scanCount += 1;

  for (const symbol of [...positions.keys()]) {
    const snapshot = snapshots?.[symbol] || snapshots?.[compact(symbol)];
    if (snapshot) checkExit(symbol, snapshot, now);
  }

  const btc1h = bars1h['BTC/USD'] || [];
  const candidates = [];
  const rejectCounts = new Map();

  for (const symbol of symbols) {
    if (positions.has(symbol)) continue;
    const asset = assetMap.get(symbol);
    const snapshot = snapshots?.[symbol] || snapshots?.[compact(symbol)];
    if (!asset || !snapshot) {
      rejectCounts.set('missing asset/snapshot', (rejectCounts.get('missing asset/snapshot') || 0) + 1);
      continue;
    }

    const result = evaluateCryptoCandidateV35({
      asset,
      snapshot,
      bars15m: bars15m[symbol] || [],
      bars1h: bars1h[symbol] || [],
      bars1d: bars1d[symbol] || [],
      btcBars1h: btc1h,
      intelligence: newsMap[compact(symbol)] || null,
      config: { cryptoV35MinScore: MIN_SCORE },
    });

    if (result.signal) {
      qualificationCount += 1;
      candidates.push(result.signal);
    } else {
      const reason = result?.reason || result?.diagnostics?.reason || 'rejected';
      rejectCounts.set(reason, (rejectCounts.get(reason) || 0) + 1);
    }
  }

  candidates.sort((a, b) => Number(b.score) - Number(a.score));
  const slots = Math.max(0, MAX_POSITIONS - positions.size);
  for (const signal of candidates.slice(0, slots)) enter(signal, now);

  const topRejects = [...rejectCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([reason, count]) => ({ reason, count }));

  console.log('[V35 crypto shadow] SCAN', JSON.stringify({
    at: now.toISOString(),
    qualified: candidates.length,
    top: candidates.slice(0, 8).map((x) => ({
      symbol: x.symbol,
      score: x.score,
      baseScore: x.signal?.baseScore,
      contextScore: x.signal?.contextScore,
      btc24hPct: x.signal?.btc24hPct,
      relative24hPct: x.signal?.relative24hPct,
      trigger: x.signal?.trigger,
    })),
    topRejects,
    summary: summary(),
  }));
}

console.log('[V35 crypto shadow] starting', JSON.stringify({
  startingEquity: STARTING_EQUITY,
  riskFraction: RISK_FRACTION,
  maxPortfolioRiskFraction: MAX_PORTFOLIO_RISK,
  maxPositions: MAX_POSITIONS,
  minScore: MIN_SCORE,
  maxTotalExposureFraction: MAX_TOTAL_EXPOSURE,
  pollMs: POLL_MS,
  orderPlacement: false,
  market: 'CRYPTO_24_7',
}));

while (true) {
  try {
    await scanOnce();
  } catch (error) {
    console.error('[V35 crypto shadow] scan error:', error?.stack || error?.message || error);
  }
  await sleep(POLL_MS);
}
