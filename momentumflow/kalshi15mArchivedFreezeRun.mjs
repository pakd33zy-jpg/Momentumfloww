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

const API = 'https://external-api.kalshi.com/trade-api/v2';
const SERIES='KXBTC15M';
const NUMBER_MARKETS=210;
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
  const rows=data.filter(Boolean), third=Math.floor(rows.length/3);
  const folds=[['early',rows.slice(0,third)],['middle',rows.slice(third,2*third)],['late',rows.slice(2*third)],['all',rows]];
  const results={};
  for(const mode of ['momentum','reversal']){
    results[mode]={};
    for(const [label,set] of folds){
      const p=scoreHistorical(set,mode);
      const stressed=scoreHistorical(set,mode,{...KALSHI_BASELINE_CONFIG,slippageDollars:0.03});
      results[mode][label]={
        normal:summarize(p),
        stress3c:summarize(stressed),
      };
      console.log('ARCHIVE_RESULT',JSON.stringify({
        method:mode,period:label,markets:p.marketCount,
        trades:p.eligibleTrades,wins:p.wins,winRate:p.winRatePct,
        pnl:p.pnlDollars,pf:p.profitFactor,dd:p.maxDrawdownPct,
        pnl3c:stressed.pnlDollars,
      }));
    }
  }
  const report={
    study:'Frozen 4-cent Kalshi BTC15M baseline in older real archived markets',
    outcome:'unverified until independent folds survive; no actual orders',
    createdAt:new Date().toISOString(),
    api:API,series:SERIES,
    dataIntegrity:{
      pages:a.pages,eligibleMarketPool:a.allCount,sampled:a.selected.length,
      dataDownloadErrors:sampleErrors,hasOneMinCandles:rows.filter(r=>r.candles.length>0).length,
      firstClose:rows[0]?.market.close_time,lastClose:rows.at(-1)?.market.close_time,
    },
    frozenRules:KALSHI_BASELINE_CONFIG,
    riskNote:'Quote-based hypothetical returns, not executed fills; verify depth/fees; NO live-money authorization',
    results,
  };
  mkdirSync('research/results',{recursive:true});
  writeFileSync('research/results/KALSHI_FROZEN_ARCHIVE_4C.json',JSON.stringify(report,null,2)+'\n');
  console.log('ARCHIVE_SOURCE',JSON.stringify(report.dataIntegrity));
  const minTrades=30;
  const pass=Object.values(results.momentum)
    .filter((_,i)=>i<3)
    .every(x=>x.normal.eligibleTrades>=minTrades &&
      x.normal.pnlDollars>0 && x.stress3c.pnlDollars>0 && x.normal.profitFactor>1);
  console.log('ARCHIVE_VERDICT',pass?'eligible-for-more-forward-shadow-testing':'NOT-VALIDATED; do not deploy');
}
try {await execute();}
catch(e){console.error('ARCHIVE_BLOCKED',String(e?.message??e)); process.exitCode=1;}
