import fetch from 'node-fetch';
import { getCryptoBars } from './alpacaClient.js';
import {
  evaluateCryptoCandidateV33,
} from './cryptoStrategyV33.js';
import {
  evaluateCryptoCandidateV34,
} from './cryptoStrategyV34.js';

const SYMBOLS = (
  process.env.V34_REPLAY_SYMBOLS ||
  'BTC/USD,ETH/USD,SOL/USD,XRP/USD,LINK/USD,AVAX/USD,LTC/USD,BCH/USD,DOGE/USD'
)
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

const DAYS = Math.max(60, Math.min(365, Number(process.env.V34_REPLAY_DAYS || 180)));
const ASSUMED_SPREAD_PCT = Math.max(0.01, Number(process.env.V34_REPLAY_SPREAD_PCT || 0.08));
const SAMPLE_EVERY_15M_BARS = Math.max(1, Number(process.env.V34_REPLAY_SAMPLE_BARS || 4));
const MFE_HOURS = Math.max(6, Number(process.env.V34_REPLAY_MFE_HOURS || 24));

const pct = (a, b) => b > 0 ? ((a / b) - 1) * 100 : 0;
const n = (v, fallback = NaN) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const ts = (bar) => new Date(bar?.t || bar?.timestamp || 0).getTime();
const open = (bar) => n(bar?.o ?? bar?.open);
const high = (bar) => n(bar?.h ?? bar?.high);
const low = (bar) => n(bar?.l ?? bar?.low);
const close = (bar) => n(bar?.c ?? bar?.close);

function sliceThrough(rows, time, maxRows) {
  // Binary-search the final row at or before `time` so replay never sees future data.
  let lo = 0;
  let hi = rows.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ts(rows[mid]) <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return [];
  return rows.slice(Math.max(0, found - maxRows + 1), found + 1);
}

function snapshotFromBar(bar) {
  const price = close(bar);
  const half = price * ASSUMED_SPREAD_PCT / 200;
  return {
    latestQuote: {
      bp: price - half,
      ap: price + half,
    },
    latestTrade: { p: price },
  };
}

function simulateTrade(signal, bars15m, signalIndex) {
  const entryBar = bars15m[signalIndex + 1];
  if (!entryBar) return null;
  const entry = open(entryBar);
  if (!(entry > 0)) return null;

  const plan = signal?.signal?.exitPlan || {};
  const stopPct = n(plan.stopLossPct);
  const takePct = n(plan.takeProfitPct);
  const costPct = Math.max(0, n(plan.estimatedRoundTripCostPct, 0));
  const maxHoldMinutes = Math.max(15, n(plan.maxHoldMinutes, 24 * 60));
  if (!(stopPct > 0) || !(takePct > 0)) return null;

  const stopPrice = entry * (1 - stopPct / 100);
  const takePrice = entry * (1 + takePct / 100);
  const maxBars = Math.max(1, Math.ceil(maxHoldMinutes / 15));
  const endIndex = Math.min(bars15m.length - 1, signalIndex + maxBars);

  let exit = close(bars15m[endIndex]);
  let exitIndex = endIndex;
  let reason = 'MAX_HOLD';
  let mfePct = 0;
  let maePct = 0;

  for (let i = signalIndex + 1; i <= endIndex; i += 1) {
    const bar = bars15m[i];
    mfePct = Math.max(mfePct, pct(high(bar), entry));
    maePct = Math.min(maePct, pct(low(bar), entry));
    const hitStop = low(bar) <= stopPrice;
    const hitTake = high(bar) >= takePrice;

    // Conservative same-bar handling: if both touched, count the stop first.
    if (hitStop) {
      exit = stopPrice;
      exitIndex = i;
      reason = hitTake ? 'STOP_SAME_BAR_AS_TARGET' : 'STOP';
      break;
    }
    if (hitTake) {
      exit = takePrice;
      exitIndex = i;
      reason = 'TARGET';
      break;
    }
  }

  const grossPct = pct(exit, entry);
  const netPct = grossPct - costPct;
  const riskPct = stopPct + costPct;
  const rMultiple = riskPct > 0 ? netPct / riskPct : 0;

  return {
    entry,
    exit,
    entryIndex: signalIndex + 1,
    exitIndex,
    reason,
    grossPct,
    netPct,
    rMultiple,
    mfePct,
    maePct,
    win: netPct > 0,
  };
}

function forwardMfe(rows15m, index, hours = MFE_HOURS) {
  const current = close(rows15m[index]);
  if (!(current > 0)) return 0;
  const bars = Math.max(1, Math.ceil(hours * 4));
  const end = Math.min(rows15m.length, index + bars + 1);
  let best = current;
  for (const bar of rows15m.slice(index + 1, end)) {
    best = Math.max(best, high(bar));
  }
  return pct(best, current);
}

function summarizeTrades(trades) {
  const count = trades.length;
  const wins = trades.filter((t) => t.win).length;
  const grossProfit = trades.filter((t) => t.netPct > 0).reduce((s, t) => s + t.netPct, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.netPct < 0).reduce((s, t) => s + t.netPct, 0));
  const avgNetPct = count ? trades.reduce((s, t) => s + t.netPct, 0) / count : 0;
  const avgR = count ? trades.reduce((s, t) => s + t.rMultiple, 0) / count : 0;

  let cumulativeR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;
  for (const trade of trades) {
    cumulativeR += trade.rMultiple;
    peakR = Math.max(peakR, cumulativeR);
    maxDrawdownR = Math.max(maxDrawdownR, peakR - cumulativeR);
  }

  return {
    trades: count,
    wins,
    losses: count - wins,
    winRatePct: count ? Number((wins / count * 100).toFixed(2)) : 0,
    avgNetPct: Number(avgNetPct.toFixed(4)),
    avgR: Number(avgR.toFixed(4)),
    profitFactor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(3)) : (grossProfit > 0 ? 999 : 0),
    cumulativeR: Number(cumulativeR.toFixed(3)),
    maxDrawdownR: Number(maxDrawdownR.toFixed(3)),
  };
}

async function fetchResearchExportBars(symbol, timeframe, days, end) {
  const base = String(process.env.RESEARCH_BASE_URL || '').replace(/\/$/, '');
  const token = String(process.env.RESEARCH_EXPORT_TOKEN || '');
  if (!base || !token) return null;

  const query = new URLSearchParams({
    symbol,
    timeframe,
    days: String(days),
    end: end.toISOString(),
  });
  const response = await fetch(`${base}/api/research/crypto-bars?${query.toString()}`, {
    headers: { 'x-research-token': token },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Research export failed (${response.status}): ${data.error || response.statusText}`);
  }
  return Array.isArray(data.bars) ? data.bars : [];
}

async function fetchBars(symbol, end) {
  const start = new Date(end.getTime() - DAYS * 24 * 60 * 60 * 1000);

  // Preferred path for isolated Railway replay: use the production backend's
  // protected bars-only research export. This avoids copying saved Alpaca keys.
  if (process.env.RESEARCH_BASE_URL && process.env.RESEARCH_EXPORT_TOKEN) {
    const [b15, b1h, b1d] = await Promise.all([
      fetchResearchExportBars(symbol, '15Min', Math.min(365, DAYS + 3), end),
      fetchResearchExportBars(symbol, '1Hour', Math.min(730, DAYS + 10), end),
      fetchResearchExportBars(symbol, '1Day', Math.min(1825, DAYS + 50), end),
    ]);
    return { start, b15, b1h, b1d };
  }

  // Local fallback for a developer machine that has paper credentials directly.
  const dailyWarmup = new Date(start.getTime() - 50 * 24 * 60 * 60 * 1000);
  const hourlyWarmup = new Date(start.getTime() - 10 * 24 * 60 * 60 * 1000);
  const fifteenWarmup = new Date(start.getTime() - 3 * 24 * 60 * 60 * 1000);

  const [b15, b1h, b1d] = await Promise.all([
    getCryptoBars('paper', [symbol], {
      timeframe: '15Min', start: fifteenWarmup, end, limit: 10000, sort: 'asc', maxPages: 5,
    }),
    getCryptoBars('paper', [symbol], {
      timeframe: '1Hour', start: hourlyWarmup, end, limit: 10000, sort: 'asc', maxPages: 3,
    }),
    getCryptoBars('paper', [symbol], {
      timeframe: '1Day', start: dailyWarmup, end, limit: 10000, sort: 'asc', maxPages: 2,
    }),
  ]);

  return {
    start,
    b15: b15[symbol] || b15[symbol.replace('/', '')] || [],
    b1h: b1h[symbol] || b1h[symbol.replace('/', '')] || [],
    b1d: b1d[symbol] || b1d[symbol.replace('/', '')] || [],
  };
}

async function replaySymbol(symbol, end) {
  const { start, b15, b1h, b1d } = await fetchBars(symbol, end);
  const asset = { symbol, name: symbol };

  const v33Trades = [];
  const v34Trades = [];
  const scores33 = [];
  const scores34 = [];
  let evaluated = 0;
  let v33Qualified = 0;
  let v34Qualified = 0;
  let rescuedLargeMoves1 = 0;
  let rescuedLargeMoves2 = 0;
  let v33MissedLargeMoves1 = 0;
  let v33MissedLargeMoves2 = 0;
  let nextFree33 = 0;
  let nextFree34 = 0;

  for (let i = 0; i < b15.length - 2; i += SAMPLE_EVERY_15M_BARS) {
    const time = ts(b15[i]);
    if (time < start.getTime()) continue;

    const bars15m = b15.slice(Math.max(0, i - 79), i + 1);
    const bars1h = sliceThrough(b1h, time, 100);
    const bars1d = sliceThrough(b1d, time, 60);
    if (bars15m.length < 40 || bars1h.length < 50 || bars1d.length < 35) continue;

    evaluated += 1;
    const snapshot = snapshotFromBar(b15[i]);
    const args = { asset, snapshot, bars15m, bars1h, bars1d };
    const r33 = evaluateCryptoCandidateV33(args);
    const r34 = evaluateCryptoCandidateV34(args);
    const s33 = r33.signal?.score ?? r33.diagnostics?.score ?? r33.diagnostics?.metrics?.score ?? null;
    const s34 = r34.signal?.score ?? r34.diagnostics?.score ?? r34.diagnostics?.metrics?.score ?? null;
    if (Number.isFinite(Number(s33))) scores33.push(Number(s33));
    if (Number.isFinite(Number(s34))) scores34.push(Number(s34));

    const mfe = forwardMfe(b15, i);
    if (!r33.signal && mfe >= 1) v33MissedLargeMoves1 += 1;
    if (!r33.signal && mfe >= 2) v33MissedLargeMoves2 += 1;

    if (r33.signal) {
      v33Qualified += 1;
      if (i >= nextFree33) {
        const trade = simulateTrade(r33.signal, b15, i);
        if (trade) {
          v33Trades.push(trade);
          nextFree33 = trade.exitIndex + 1;
        }
      }
    }

    if (r34.signal) {
      v34Qualified += 1;
      if (!r33.signal && mfe >= 1) rescuedLargeMoves1 += 1;
      if (!r33.signal && mfe >= 2) rescuedLargeMoves2 += 1;
      if (i >= nextFree34) {
        const trade = simulateTrade(r34.signal, b15, i);
        if (trade) {
          v34Trades.push(trade);
          nextFree34 = trade.exitIndex + 1;
        }
      }
    }
  }

  const avgScore = (rows) => rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : null;
  return {
    symbol,
    barCounts: { m15: b15.length, h1: b1h.length, d1: b1d.length },
    evaluated,
    v33Qualified,
    v34Qualified,
    qualificationRatePct: {
      v33: evaluated ? Number((v33Qualified / evaluated * 100).toFixed(3)) : 0,
      v34: evaluated ? Number((v34Qualified / evaluated * 100).toFixed(3)) : 0,
    },
    averageScoredCandidate: {
      v33: avgScore(scores33) == null ? null : Number(avgScore(scores33).toFixed(3)),
      v34: avgScore(scores34) == null ? null : Number(avgScore(scores34).toFixed(3)),
    },
    v33MissedForwardMoves: {
      atLeast1Pct24h: v33MissedLargeMoves1,
      atLeast2Pct24h: v33MissedLargeMoves2,
    },
    v34RecoveredFromV33Misses: {
      atLeast1Pct24h: rescuedLargeMoves1,
      atLeast2Pct24h: rescuedLargeMoves2,
      recoveryRate1Pct: v33MissedLargeMoves1 ? Number((rescuedLargeMoves1 / v33MissedLargeMoves1 * 100).toFixed(2)) : 0,
      recoveryRate2Pct: v33MissedLargeMoves2 ? Number((rescuedLargeMoves2 / v33MissedLargeMoves2 * 100).toFixed(2)) : 0,
    },
    sequentialTrades: {
      v33: summarizeTrades(v33Trades),
      v34: summarizeTrades(v34Trades),
    },
  };
}

function aggregate(results) {
  const total = {
    evaluated: 0,
    v33Qualified: 0,
    v34Qualified: 0,
    missed1: 0,
    missed2: 0,
    rescued1: 0,
    rescued2: 0,
    v33Trades: [],
    v34Trades: [],
  };

  // Aggregate trade statistics from per-symbol summaries using weighted values
  // where raw trade arrays are intentionally not printed to keep logs compact.
  let v33Wins = 0, v34Wins = 0, v33Count = 0, v34Count = 0;
  let v33CumR = 0, v34CumR = 0;
  let v33WeightedNet = 0, v34WeightedNet = 0;

  for (const r of results) {
    total.evaluated += r.evaluated;
    total.v33Qualified += r.v33Qualified;
    total.v34Qualified += r.v34Qualified;
    total.missed1 += r.v33MissedForwardMoves.atLeast1Pct24h;
    total.missed2 += r.v33MissedForwardMoves.atLeast2Pct24h;
    total.rescued1 += r.v34RecoveredFromV33Misses.atLeast1Pct24h;
    total.rescued2 += r.v34RecoveredFromV33Misses.atLeast2Pct24h;

    const a = r.sequentialTrades.v33;
    const b = r.sequentialTrades.v34;
    v33Wins += a.wins; v34Wins += b.wins;
    v33Count += a.trades; v34Count += b.trades;
    v33CumR += a.cumulativeR; v34CumR += b.cumulativeR;
    v33WeightedNet += a.avgNetPct * a.trades;
    v34WeightedNet += b.avgNetPct * b.trades;
  }

  return {
    evaluated: total.evaluated,
    qualifications: {
      v33: total.v33Qualified,
      v34: total.v34Qualified,
      v33RatePct: total.evaluated ? Number((total.v33Qualified / total.evaluated * 100).toFixed(3)) : 0,
      v34RatePct: total.evaluated ? Number((total.v34Qualified / total.evaluated * 100).toFixed(3)) : 0,
      v34ToV33Multiple: total.v33Qualified ? Number((total.v34Qualified / total.v33Qualified).toFixed(2)) : null,
    },
    missedMoveRecovery: {
      v33Missed1Pct24h: total.missed1,
      v34Recovered1Pct24h: total.rescued1,
      recoveryRate1Pct: total.missed1 ? Number((total.rescued1 / total.missed1 * 100).toFixed(2)) : 0,
      v33Missed2Pct24h: total.missed2,
      v34Recovered2Pct24h: total.rescued2,
      recoveryRate2Pct: total.missed2 ? Number((total.rescued2 / total.missed2 * 100).toFixed(2)) : 0,
    },
    sequentialTradeQuality: {
      v33: {
        trades: v33Count,
        winRatePct: v33Count ? Number((v33Wins / v33Count * 100).toFixed(2)) : 0,
        avgNetPct: v33Count ? Number((v33WeightedNet / v33Count).toFixed(4)) : 0,
        cumulativeR: Number(v33CumR.toFixed(3)),
      },
      v34: {
        trades: v34Count,
        winRatePct: v34Count ? Number((v34Wins / v34Count * 100).toFixed(2)) : 0,
        avgNetPct: v34Count ? Number((v34WeightedNet / v34Count).toFixed(4)) : 0,
        cumulativeR: Number(v34CumR.toFixed(3)),
      },
    },
  };
}

async function main() {
  const end = process.env.V34_REPLAY_END
    ? new Date(process.env.V34_REPLAY_END)
    : new Date();
  if (!Number.isFinite(end.getTime())) throw new Error('Invalid V34_REPLAY_END');

  const startedAt = new Date();
  const results = [];
  for (const symbol of SYMBOLS) {
    console.log(`[V34 replay] fetching/replaying ${symbol}...`);
    try {
      const result = await replaySymbol(symbol, end);
      results.push(result);
      console.log(`[V34 replay] ${symbol}: V33 ${result.v33Qualified}/${result.evaluated}, V34 ${result.v34Qualified}/${result.evaluated}, trades ${result.sequentialTrades.v33.trades}/${result.sequentialTrades.v34.trades}`);
    } catch (error) {
      console.error(`[V34 replay] ${symbol} failed: ${error.message}`);
      results.push({ symbol, error: error.message });
    }
  }

  const good = results.filter((r) => !r.error);
  const report = {
    version: 'V34_REPLAY_1',
    methodology: {
      periodDays: DAYS,
      end: end.toISOString(),
      symbols: SYMBOLS,
      sampleEvery15mBars: SAMPLE_EVERY_15M_BARS,
      assumedHistoricalSpreadPct: ASSUMED_SPREAD_PCT,
      explicitRoundTripCosts: true,
      execution: 'signal at completed 15m bar; enter next 15m open; conservative stop-first if stop and target touch same bar; no trailing-stop simulation',
      caveat: 'Historical quote spreads and news are not replayed in this first pass; this isolates V33 vs V34 technical opportunity/entry logic under identical assumptions.',
    },
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    aggregate: aggregate(good),
    symbols: results,
  };

  console.log('V34_REPLAY_REPORT_START');
  console.log(JSON.stringify(report, null, 2));
  console.log('V34_REPLAY_REPORT_END');

  if (!good.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
