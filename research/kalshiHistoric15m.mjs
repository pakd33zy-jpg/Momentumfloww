/**
 * Historical backtest on REAL Kalshi market candles and settled outcomes.
 * No API key. No orders. Never claims a historical close quote was a real fill.
 * Fixed predeclared rules: minute-7 YES midpoint momentum >= 3c;
 * 1 minute delayed entry quote, 1c adverse slippage, taker-fee estimate,
 * no martingale, maximum 1% simulated capital at risk per position.
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const ROOT = 'https://external-api.kalshi.com/trade-api/v2';
const SERIES = 'KXBTC15M';
const SETTINGS = Object.freeze({
  listPages: 7, pageSize: 1000, selectedMarkets: 130,
  initialEquity: 1000, stakeFraction: 0.01,
  signalCents: 0.03, slippage: 0.01, maxContracts: 100,
  feeRate: 0.07, minEntryAsk: 0.08, maxEntryAsk: 0.90,
  minimumTradesToAssess: 30,
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const round = n => Number(n.toFixed(4));
const secs = s => Math.floor(Date.parse(s) / 1000);
const num = s => s === null || s === undefined || s === '' ? NaN : Number(s);
const positiveProb = n => Number.isFinite(n) && n > 0 && n < 1;

async function request(path, query = {}) {
  const u = new URL(ROOT + path);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch(u, { method: 'GET', signal: AbortSignal.timeout(15000), headers: { accept: 'application/json' } });
      if (res.ok) return await res.json();
      if (res.status !== 429 && res.status < 500) throw new Error('Kalshi historical HTTP ' + res.status);
    } catch (e) {
      if (attempt === 3) throw e;
    }
    if (attempt === 3) throw new Error('Kalshi historical request retries exhausted HTTP ' + (res?.status ?? 'unknown'));
    await wait(1000 * (attempt + 1));
  }
}

export function historicalCandleDecision(market, candles, settings = SETTINGS) {
  const closeTs = secs(market.close_time);
  if (!Number.isSafeInteger(closeTs) || !['yes', 'no'].includes(market.result)) {
    return { skip: 'not-a-settled-binary-market' };
  }
  const startTs = closeTs - 15 * 60;
  if (Number.isFinite(secs(market.open_time)) && secs(market.open_time) > startTs + 3 * 60) {
    return { skip: 'market-not-open-in-decision-window' };
  }
  const rows = (candles ?? []).filter(c => Number.isSafeInteger(c.end_period_ts))
    .sort((a,b) => a.end_period_ts - b.end_period_ts);
  const decisionTs = startTs + 7 * 60; // only completed minutes 0..7
  const entryTs = startTs + 8 * 60; // end-minute-8 quote, after signal decision
  const signalRows = rows.filter(c => c.end_period_ts >= startTs + 3 * 60 && c.end_period_ts <= decisionTs);
  const entry = rows.find(c => c.end_period_ts === entryTs);
  if (signalRows.length < 3 || !entry) return { skip: 'missing-timestamped-candles' };
  const mid = c => {
    const b = num(c?.yes_bid?.close_dollars ?? c?.yes_bid?.close);
    const a = num(c?.yes_ask?.close_dollars ?? c?.yes_ask?.close);
    return positiveProb(b) && positiveProb(a) && b <= a ? (a+b)/2 : NaN;
  };
  const first = mid(signalRows[0]), last = mid(signalRows.at(-1));
  if (!Number.isFinite(first) || !Number.isFinite(last)) return { skip: 'missing-two-sided-signal-quotes' };
  const move = last - first;
  if (Math.abs(move) < settings.signalCents) return { skip: 'no-signal' };
  const buyYes = num(entry?.yes_ask?.close_dollars ?? entry?.yes_ask?.close);
  const yesBid = num(entry?.yes_bid?.close_dollars ?? entry?.yes_bid?.close);
  if (!positiveProb(buyYes) || !positiveProb(yesBid) || buyYes < yesBid) {
    return { skip: 'missing-executable-side-quote' };
  }
  return {
    ticker: market.ticker, close_time: market.close_time, result: market.result,
    move: round(move), yesAsk: buyYes, noAsk: 1-yesBid,
    entryTs, decisionTs, source: 'Kalshi historical 1-minute bid/ask quotes',
  };
}

export function simulatedTakerFee(contracts, unitPrice, rate = SETTINGS.feeRate) {
  return Math.ceil((contracts * unitPrice * (1-unitPrice) * rate - 1e-10) * 100) / 100;
}
export function paperPortfolio(decisions, method, settings = SETTINGS) {
  const ordered = [...decisions].filter(d => !d.skip).sort((a,b)=>secs(a.close_time)-secs(b.close_time));
  let equity = settings.initialEquity, peak = equity, maxDD = 0;
  let won=0, lost=0, netWinningDollars=0, netLosingDollars=0;
  const trades=[], skipped={};
  for (const d of ordered) {
    const primary = d.move > 0 ? 'yes' : 'no';
    const side = method === 'momentum' ? primary : method === 'reversal' ? (primary === 'yes' ? 'no' : 'yes') : 'yes';
    const quote = (side === 'yes' ? d.yesAsk : d.noAsk) + settings.slippage;
    if (quote < settings.minEntryAsk || quote > settings.maxEntryAsk || !Number.isFinite(quote)) {
      skipped['outside-quote-range'] = (skipped['outside-quote-range'] || 0) + 1;
      continue;
    }
    const budget = equity * settings.stakeFraction;
    let n = Math.min(settings.maxContracts, Math.floor(budget / quote));
    while (n > 0 && n*quote + simulatedTakerFee(n,quote,settings.feeRate) > budget + 1e-8) n--;
    if (n <= 0) { skipped['insufficient-risk-budget'] = (skipped['insufficient-risk-budget']||0)+1; continue; }
    const fee = simulatedTakerFee(n, quote, settings.feeRate);
    const cost = n*quote+fee;
    const win = d.result === side;
    const pnl = (win ? n : 0) - cost;
    equity += pnl;
    if (win) { won++; netWinningDollars += pnl; }
    else {lost++; netLosingDollars += -pnl;}
    peak = Math.max(peak,equity); maxDD=Math.max(maxDD, (peak-equity)/peak*100);
    trades.push({ticker:d.ticker, close_time:d.close_time, side, result:d.result,
      askObserved:round(quote-settings.slippage), assumedFillPrice:round(quote),
      stake:round(cost), n, fee, win, pnl:round(pnl), balance:round(equity)});
  }
  const count = trades.length;
  return {
    method, initialEquity: settings.initialEquity, endingEquity:round(equity),
    netPnl:round(equity-settings.initialEquity),
    returnPct:round((equity/settings.initialEquity-1)*100),
    trades:count, wins:won, losses:lost,
    winRatePct:count?round(won/count*100):null,
    profitFactor:netLosingDollars>0 ? round(netWinningDollars/netLosingDollars):null,
    maxDrawdownPct:round(maxDD),skipped,tradeLog:trades,
  };
}
async function listArchive() {
  const out=[]; let cursor='';
  for (let i=0;i<SETTINGS.listPages;i++){
    const data=await request('/historical/markets',{series_ticker:SERIES,limit:SETTINGS.pageSize,cursor});
    if (!Array.isArray(data.markets)) throw new Error('Historical markets response missing markets array');
    out.push(...data.markets.filter(m=>['yes','no'].includes(m.result) && m.ticker?.startsWith(SERIES) && Number.isFinite(secs(m.close_time))));
    cursor=data.cursor||'';
    if (!cursor) break;
    await wait(250);
  }
  // No filtering based on whether YES or NO happened. Fixed systematic spacing
  // over chronological archived markets to capture multiple periods/regimes.
  const sorted=out.sort((a,b)=>secs(a.close_time)-secs(b.close_time));
  const step=Math.max(1,Math.floor(sorted.length / SETTINGS.selectedMarkets));
  const selected=sorted.filter((_,i)=>i%step===0).slice(0,SETTINGS.selectedMarkets);
  return {listed:out.length,selected,sourcePages:Math.min(SETTINGS.listPages,Math.ceil(out.length/SETTINGS.pageSize))};
}

export async function runHistorical() {
  const started=new Date().toISOString();
  const {listed,selected,sourcePages}=await listArchive();
  const rows=[], errorCounts={};
  for (let i=0;i<selected.length;i++) {
    const m=selected[i], close=secs(m.close_time);
    try {
      const x=await request('/historical/markets/'+encodeURIComponent(m.ticker)+'/candlesticks',{
        start_ts:close-900,end_ts:close,period_interval:1,
      });
      rows.push(historicalCandleDecision(m,x.candlesticks));
    }catch(error){
      const msg=String(error?.message||error);
      errorCounts[msg]=(errorCounts[msg]||0)+1;
    }
    await wait(300);
  }
  const counts={};
  for(const row of rows)if(row.skip)counts[row.skip]=(counts[row.skip]||0)+1;
  const eligible=rows.filter(d=>!d.skip);
  // Frozen 70/30 chronological split; never use test split for rule selection.
  const split=Math.floor(eligible.length*0.70);
  const methods=['momentum','reversal','always-yes'];
  const results=Object.fromEntries(methods.map(x=>[x,{
    first70:paperPortfolio(eligible.slice(0,split),x),
    last30:paperPortfolio(eligible.slice(split),x),
    entireSample:paperPortfolio(eligible,x),
  }]));
  return {
    status:eligible.length<SETTINGS.minimumTradesToAssess?'insufficient-data':'complete',
    study:'Kalshi real historical KXBTC15M 1m quotes + actual settled results',
    createdAt:new Date().toISOString(),started,apiRoot:ROOT,series:SERIES,
    researchOnly:true,liveOrdersSent:0,
    quoteFills:'hypothetical historical candle-close asks + adverse 1c slippage; NOT actual executable fills',
    limitations:[
      'L1 historical minute-end quotes may not have executable depth at requested size',
      'Taker fees modeled at 7% p(1-p), rounded up; product-specific schedules may differ',
      'Conservative 1% capital-at-risk limit; fee and slippage included',
      'No selection tuning to last30; no prediction model calibrated yet',
      'Do not infer live-money profitability from historical backtests',
    ],
    settings:SETTINGS,marketsListed:listed,sourcePages,marketsSampled:selected.length,
    marketsWithData:rows.length,eligibleSignals:eligible.length,skippedReasons:counts,
    apiErrors:errorCounts,firstMarket:eligible[0]?.close_time??null,lastMarket:eligible.at(-1)?.close_time??null,
    results,
  };
}

if (process.argv[1]?.endsWith('kalshiHistoric15m.mjs')) {
  const target='research/results/KALSHI_BTC15M_REAL_HISTORY.json';
  let report;
  try {report=await runHistorical();}
  catch(error){ report={status:'blocked',createdAt:new Date().toISOString(),error:String(error.message),
    study:'Kalshi real historical KXBTC15M 1m quotes + actual settled results',
    researchOnly:true,liveOrdersSent:0,noResultsClaimed:true};}
  mkdirSync('research/results',{recursive:true});
  writeFileSync(target,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({
    status:report.status,marketsListed:report.marketsListed,
    marketsSampled:report.marketsSampled,eligibleSignals:report.eligibleSignals,
    historicalPrimaryPnl:report.results?.momentum?.entireSample?.netPnl ?? null,
    error:report.error??null,output:target,
  }));
}
