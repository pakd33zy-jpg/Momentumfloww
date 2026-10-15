/**
 * Independent historical validation of the EXACT same frozen Kalshi BTC15M
 * momentum/reversal logic used in the recent 320-market audit.
 *
 * Data: REAL finalized historical markets and 1-minute Kalshi bid/ask candles.
 * Orders: NONE. Authentication: NONE. Pricing: hypothetical minute-8 quotes,
 * not proven fills. No optimization, no martingale, no leverage.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { scoreHistorical, KALSHI_BASELINE_CONFIG } from './kalshi15mBacktestCore.js';
import { trainCalibration, evaluateHoldout, prepareCalibratedMarket, CALIBRATION } from './kalshiEmpiricalCalibration.js';

const API = 'https://external-api.kalshi.com/trade-api/v2';
const SERIES='KXBTC15M';
const NUMBER_MARKETS=420;
const MAX_LIST_PAGES=7;
const PAGE_LIMIT=1000;
const DELAY_MS=350;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const ts=x=>Date.parse(x)/1000;

async function get(endpoint, args={}) {
  const u=new URL(API+endpoint);
  for (const [k,v] of Object.entries(args)) if(v!==undefined&&v!==null)u.searchParams.set(k,String(v));
  let err;
  for(let i=0;i<4;i++){
    try{
      const r=await fetch(u.toString(), {method:'GET', signal:AbortSignal.timeout(16000),headers:{accept:'application/json'}});
      if(r.ok) return r.json();
      err=new Error('HTTP '+r.status);
      if(r.status!==429&&r.status<500)throw err;
    }catch(e){err=e;if(String(e.message).startsWith('HTTP 4')&&!String(e.message).includes('429'))throw e;}
    await sleep(750*(i+1));
  }
  throw new Error('Kalshi archive request failed: '+(err?.message||'unknown'));
}
async function listArchive(){
  const out=[], found=new Set();
  let cursor='',pages=0;
  for(let i=0;i<MAX_LIST_PAGES;i++){
    const v=await get('/historical/markets',{series_ticker:SERIES,limit:PAGE_LIMIT,cursor:cursor||undefined});
    if(!Array.isArray(v.markets))throw new Error('Invalid archive market response');
    pages++;
    for(const m of v.markets){
      // No outcome-based sample filtering! Filter for availability/validity only.
      if(!m.ticker?.startsWith(SERIES+'-')||found.has(m.ticker))continue;
      if(!Number.isFinite(ts(m.close_time))||!Number.isFinite(ts(m.open_time)))continue;
      if(Math.abs(ts(m.close_time)-ts(m.open_time)-900)>5)continue;
      if(!['yes','no'].includes(m.result))continue;
      found.add(m.ticker);out.push(m);
    }
    cursor=v.cursor||'';
    if(!cursor)break;
    await sleep(300);
  }
  if(out.length<NUMBER_MARKETS)throw new Error('Too few complete archived BTC15M markets: '+out.length);
  out.sort((a,b)=>ts(a.close_time)-ts(b.close_time));
  const selected=Array.from({length:NUMBER_MARKETS},(_,i)=>out[Math.floor((i+.5)*out.length/NUMBER_MARKETS)]);
  return {pages,allCount:out.length,selected};
}
const summarize=r=>{
  const {trades,...summary}=r;
  return {...summary, lastFive:trades.slice(-5)};
};
async function execute(){
  const a=await listArchive();
  const data=new Array(a.selected.length);
  const sampleErrors={};
  let cursor=0;
  const worker=async()=>{
    while(true){
      const i=cursor++;
      if(i>=a.selected.length)break;
      const m=a.selected[i],start=ts(m.open_time),end=ts(m.close_time);
      try{
        const result=await get('/historical/markets/'+encodeURIComponent(m.ticker)+'/candlesticks',
          {start_ts:start+60,end_ts:end+60,period_interval:1});
        data[i]={market:m,candles:result.candlesticks??[]};
      }catch(e){
        const key=String(e?.message??e);
        sampleErrors[key]=(sampleErrors[key]||0)+1;
        data[i]={market:m,candles:[]};
      }
      await sleep(DELAY_MS);
    }
  };
  await Promise.all([worker(),worker(),worker()]);
  const raw=data.filter(Boolean);
  // Fixed chronological 70/30 split across ALL sampled contracts, including
  // no-signal and missing-quote cases, determined before any outcomes are scored.
  const split=Math.floor(raw.length*.70);
  const trainingRaw=raw.slice(0,split), holdoutRaw=raw.slice(split);
  const train=trainingRaw.map(prepareCalibratedMarket);
  const holdout=holdoutRaw.map(prepareCalibratedMarket);
  const calibration=trainCalibration(train);
  const evaluated=evaluateHoldout(holdout,calibration);
  const stress=evaluateHoldout(holdout,calibration,{...CALIBRATION,slip:.03});
  const noFilter=scoreHistorical(holdoutRaw,'momentum');
  const reversal=scoreHistorical(holdoutRaw,'reversal');
  const integrity={
    archivePages:a.pages,eligibleMarketPool:a.allCount,sampled:raw.length,
    trainingMarkets:trainingRaw.length,holdoutMarkets:holdoutRaw.length,
    candlesDownloaded:raw.filter(v=>v.candles.length>0).length,
    apiErrors:sampleErrors,
    firstClose:raw[0]?.market.close_time,
    cutoffClose:trainingRaw.at(-1)?.market.close_time,
    firstHoldoutClose:holdoutRaw[0]?.market.close_time,
    lastClose:raw.at(-1)?.market.close_time,
  };
  const verdict=evaluated.trades>=CALIBRATION.minHoldoutTrades &&
    evaluated.netPnl>0&&evaluated.profitFactor>1&&
    stress.netPnl>0&&stress.profitFactor>1
      ? 'NEEDS_PROSPECTIVE_DEMO_VALIDATION'
      : 'NO_VALIDATED_EDGE';
  const {tradeLog,...calibrationSummary}=evaluated;
  const {tradeLog:stressLog,...stressSummary}=stress;
  const {trades:baseLog,...baselineSummary}=noFilter;
  const {trades:reversalLog,...reversalSummary}=reversal;
  const report={
    study:'Kalshi empirical probabilities with strictly past-market training',
    verdict,createdAt:new Date().toISOString(),realHistoricalMarkets:true,
    estimatedFillOnly:true,realOrDemoOrdersSent:0,trainingPolicy:'train first 70% only; frozen bins/thresholds; evaluate latest 30% once',
    limitation:'Empirical calibration is NOT an external weather/crypto probability forecast; historical depth/execution unknown.',
    config:{...CALIBRATION,base:KALSHI_BASELINE_CONFIG},
    integrity,calibration,
    holdout:{
      calibrated:{...calibrationSummary,tradeLog},
      slippage3c:{...stressSummary,tradeLog:stressLog},
      rawMomentum:{...baselineSummary,last5:baseLog.slice(-5)},
      rawReversal:{...reversalSummary,last5:reversalLog.slice(-5)},
    },
  };
  mkdirSync('research/results',{recursive:true});
  writeFileSync('research/results/KALSHI_EMPIRICAL_PROB_420.json',JSON.stringify(report,null,2)+'\n');
  console.log('KALSHI_CALIBRATION_DATA',JSON.stringify(integrity));
  console.log('KALSHI_CALIBRATION_BINS',JSON.stringify(calibration.bins));
  for(const [name,x] of Object.entries({
    calibrated:calibrationSummary,stress3c:stressSummary,momentum:baselineSummary,reversal:reversalSummary
  })) {
    console.log('KALSHI_HELDOUT_SCORE',JSON.stringify({
      model:name,nTrades:x.trades??x.eligibleTrades,
      wins:x.wins,losses:x.losses,winRate:x.winRatePct,
      pnl:x.netPnl??x.pnlDollars,pf:x.profitFactor,maxDD:x.maxDrawdownPct,
    }));
  }
  console.log('KALSHI_EDGE_VERDICT',verdict);
}
try{await execute()}catch(error){console.error('KALSHI_CALIBRATION_BLOCKED',String(error?.message??error));process.exitCode=1;}
