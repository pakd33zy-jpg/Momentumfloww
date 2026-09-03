// V36 historical research harness.
// Usage: node v36Backtest.mjs path/to/history.jsonl
// JSONL rows: {symbol,t,o,h,l,c,v,bid?,ask?}. Bars must be chronological or sortable.
// Research only. It never imports broker/order code and cannot place orders.

import fs from 'node:fs';
import { evaluateEquityCandidateV36 } from './equityStrategyV36.js';

const file = process.argv[2] || process.env.V36_DATASET;
if (!file || !fs.existsSync(file)) {
  console.error('V36_DATASET_MISSING: provide a historical JSONL dataset path.');
  process.exit(2);
}

const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line, i) => {
  try { return JSON.parse(line); } catch { throw new Error(`bad JSON on line ${i + 1}`); }
});

const N = (v, f = NaN) => Number.isFinite(Number(v)) ? Number(v) : f;
const bySymbol = new Map();
for (const r of rows) {
  const symbol = String(r.symbol || '').toUpperCase();
  const t = new Date(r.t || r.timestamp).getTime();
  if (!symbol || !Number.isFinite(t) || !(N(r.c ?? r.close) > 0)) continue;
  const bar = { symbol, t, o:N(r.o ?? r.open), h:N(r.h ?? r.high), l:N(r.l ?? r.low), c:N(r.c ?? r.close), v:N(r.v ?? r.volume,0), bid:N(r.bid), ask:N(r.ask) };
  if (!bySymbol.has(symbol)) bySymbol.set(symbol, []);
  bySymbol.get(symbol).push(bar);
}
for (const bars of bySymbol.values()) bars.sort((a,b) => a.t - b.t);

function inferRegime(bars, i) {
  const w = bars.slice(Math.max(0, i - 60), i + 1);
  if (w.length < 30) return { direction:'NEUTRAL', label:'UNKNOWN' };
  const first = w[0].c, last = w.at(-1).c;
  const ret = (last / first - 1) * 100;
  const rets = [];
  let path = 0;
  for (let j=1;j<w.length;j++) {
    const r = (w[j].c / w[j-1].c - 1) * 100;
    rets.push(r); path += Math.abs(r);
  }
  const mean = rets.reduce((a,b)=>a+b,0) / Math.max(1,rets.length);
  const variance = rets.reduce((a,b)=>a+(b-mean)**2,0) / Math.max(1,rets.length);
  const vol = Math.sqrt(variance);
  const efficiency = path > 0 ? Math.abs(ret) / path : 0;
  if (vol >= 0.65 && efficiency < 0.30) return { direction:'NEUTRAL', label:'HIGH_VOL_CHOP' };
  if (efficiency < 0.22) return { direction:'NEUTRAL', label:'SIDEWAYS_CHOP' };
  if (ret >= 1.0) return { direction:'LONG', label:'BULL' };
  if (ret <= -1.0) return { direction:'SHORT', label:'BEAR' };
  return { direction:'NEUTRAL', label:'SIDEWAYS' };
}

function snapshot(bar) {
  const spread = Number.isFinite(bar.bid) && Number.isFinite(bar.ask) && bar.ask >= bar.bid
    ? { bp:bar.bid, ap:bar.ask }
    : { bp:bar.c * 0.9996, ap:bar.c * 1.0004 };
  return { latestTrade:{p:bar.c}, latestQuote:spread, minuteBar:{c:bar.c} };
}

function runSlice(symbol, bars, start, end, costFactor) {
  const trades = [];
  let pos = null;
  for (let i=Math.max(start, 40); i<end-1; i++) {
    const bar = bars[i];
    if (pos) {
      const minutesHeld = i - pos.entryIndex;
      const hi = bar.h, lo = bar.l;
      const stopPx = pos.direction === 'LONG' ? pos.entry * (1-pos.stopPct/100) : pos.entry * (1+pos.stopPct/100);
      const targetPx = pos.direction === 'LONG' ? pos.entry * (1+pos.targetPct/100) : pos.entry * (1-pos.targetPct/100);
      const stopHit = pos.direction === 'LONG' ? lo <= stopPx : hi >= stopPx;
      const targetHit = pos.direction === 'LONG' ? hi >= targetPx : lo <= targetPx;
      let exit = null, why = null;
      // Conservative sequencing: if both occur on same bar, stop wins.
      if (stopHit) { exit = stopPx; why='STOP'; }
      else if (targetHit) { exit = targetPx; why='TARGET'; }
      else if (minutesHeld >= pos.maxHold) { exit = bar.c; why='TIME'; }
      if (exit != null) {
        const grossPct = (exit / pos.entry - 1) * 100 * (pos.direction === 'SHORT' ? -1 : 1);
        const netPct = grossPct - pos.costPct * costFactor;
        trades.push({ symbol, entryT:pos.entryT, exitT:bar.t, direction:pos.direction, regime:pos.regime, score:pos.score, reason:why, grossPct, netPct });
        pos = null;
      }
      continue;
    }
    const hist = bars.slice(Math.max(0, i-90), i+1).map(x => ({ t:new Date(x.t).toISOString(), o:x.o, h:x.h, l:x.l, c:x.c, v:x.v }));
    const regime = inferRegime(bars, i);
    const asset = { symbol, name:symbol, tradable:true, shortable:true, easy_to_borrow:true };
    const result = evaluateEquityCandidateV36({ asset, bars:hist, snapshot:snapshot(bar), marketRegime:regime });
    if (!result.signal) continue;
    const next = bars[i+1]; // next-bar execution prevents same-bar lookahead
    const ep = result.signal.signal.exitPlan;
    pos = {
      direction:result.signal.direction,
      entry:next.o > 0 ? next.o : next.c,
      entryT:next.t,
      entryIndex:i+1,
      stopPct:N(ep.stopLossPct,0.5),
      targetPct:N(ep.takeProfitPct,1),
      maxHold:Math.max(5, Math.round(N(ep.maxHoldMinutes,35))),
      costPct:N(ep.estimatedRoundTripCostPct,0.04),
      regime:regime.label,
      score:result.signal.score,
    };
  }
  return trades;
}

function stats(trades) {
  const wins = trades.filter(t=>t.netPct>0), losses=trades.filter(t=>t.netPct<=0);
  const gp = wins.reduce((a,t)=>a+t.netPct,0), gl = -losses.reduce((a,t)=>a+t.netPct,0);
  let equity=0, peak=0, maxDD=0;
  for (const t of trades) { equity += t.netPct; peak=Math.max(peak,equity); maxDD=Math.max(maxDD,peak-equity); }
  return { trades:trades.length, wins:wins.length, losses:losses.length, winRate:trades.length?wins.length/trades.length:0, profitFactor:gl>0?gp/gl:(gp>0?Infinity:0), netPct:equity, maxDrawdownPct:maxDD };
}

const allTimes = rows.map(r=>new Date(r.t || r.timestamp).getTime()).filter(Number.isFinite).sort((a,b)=>a-b);
const minT=allTimes[0], maxT=allTimes.at(-1);
if (!(maxT > minT)) throw new Error('dataset has insufficient chronological span');
const holdoutStart = minT + (maxT-minT)*0.80;
const foldBounds = [0,.2,.4,.6,.8].map(x=>minT+(maxT-minT)*x);
const report = { dataset:{rows:rows.length,symbols:bySymbol.size,minT:new Date(minT).toISOString(),maxT:new Date(maxT).toISOString(),holdoutStart:new Date(holdoutStart).toISOString()}, costs:{}, pass:false, failures:[] };

for (const factor of [1,2,4]) {
  const factorTrades=[];
  const folds=[];
  for (let f=0;f<4;f++) {
    const ft=[];
    for (const [symbol,bars] of bySymbol) {
      const s=bars.findIndex(b=>b.t>=foldBounds[f]);
      const e0=bars.findIndex(b=>b.t>=foldBounds[f+1]);
      const e=e0<0?bars.length:e0;
      if (s>=0 && e-s>50) ft.push(...runSlice(symbol,bars,s,e,factor));
    }
    folds.push(stats(ft)); factorTrades.push(...ft);
  }
  const hold=[];
  for (const [symbol,bars] of bySymbol) {
    const s=bars.findIndex(b=>b.t>=holdoutStart);
    if (s>=0 && bars.length-s>50) hold.push(...runSlice(symbol,bars,s,bars.length,factor));
  }
  const regimes={};
  for (const t of [...factorTrades,...hold]) {
    if (!regimes[t.regime]) regimes[t.regime]=[];
    regimes[t.regime].push(t);
  }
  report.costs[`${factor}x`] = { walkForward:stats(factorTrades), folds, holdout:stats(hold), regimes:Object.fromEntries(Object.entries(regimes).map(([k,v])=>[k,stats(v)])) };
}

// Deliberately strict research gate. No PAPER advancement unless every cost stress is positive,
// every chronological fold with enough trades is positive, holdout is positive, and major regimes
// represented by >=20 trades are positive. This avoids one lucky period carrying the strategy.
for (const factor of [1,2,4]) {
  const r=report.costs[`${factor}x`];
  if (r.walkForward.trades < 200) report.failures.push(`${factor}x insufficient walk-forward trades (${r.walkForward.trades}<200)`);
  if (!(r.walkForward.netPct>0 && r.walkForward.profitFactor>1.05)) report.failures.push(`${factor}x walk-forward not profitable`);
  if (r.holdout.trades < 50) report.failures.push(`${factor}x insufficient holdout trades (${r.holdout.trades}<50)`);
  if (!(r.holdout.netPct>0 && r.holdout.profitFactor>1.05)) report.failures.push(`${factor}x holdout not profitable`);
  r.folds.forEach((s,i)=>{ if (s.trades>=25 && s.netPct<=0) report.failures.push(`${factor}x fold ${i+1} negative`); });
  for (const [name,s] of Object.entries(r.regimes)) if (s.trades>=20 && s.netPct<=0) report.failures.push(`${factor}x regime ${name} negative`);
}
report.pass = report.failures.length===0;
console.log(JSON.stringify(report,null,2));
process.exit(report.pass ? 0 : 1);
