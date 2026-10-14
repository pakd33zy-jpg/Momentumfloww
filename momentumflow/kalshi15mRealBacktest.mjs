import { scoreHistorical, KALSHI_BASELINE_CONFIG } from './kalshi15mBacktestCore.js';

const BASE='https://external-api.kalshi.com/trade-api/v2';
const SERIES='KXBTC15M';
const MARKET_LIMIT=160;
const dataRange=process.env.KALSHI_RANGE==='prior'?'prior':'recent';
const priorCutoff=Math.floor(Date.parse('2026-10-13T06:15:00Z')/1000)-1;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(path) {
 let error;
 for(let attempt=0;attempt<4;attempt++){
  try{
   const response=await fetch(BASE+path,{method:'GET',signal:AbortSignal.timeout(14000)});
   if(response.ok)return response.json();
   if(response.status!==429 && response.status<500)throw new Error('HTTP '+response.status);
   error=new Error('HTTP '+response.status);
  }catch(e){error=e}
  await sleep(600*(attempt+1)**2);
 }
 throw new Error('Kalshi data GET failed ('+String(error?.message||error)+')');
}
const marketsResponse=await get('/markets?status=settled&series_ticker='+SERIES+'&limit='+MARKET_LIMIT+(dataRange==='prior'?'&max_settled_ts='+priorCutoff:''));
const markets=(marketsResponse.markets||[])
 .filter(m=>m.result==='yes'||m.result==='no')
 .filter(m=>Number.isFinite(Date.parse(m.open_time))&&Number.isFinite(Date.parse(m.close_time)))
 .sort((a,b)=>Date.parse(a.close_time)-Date.parse(b.close_time));
if(!markets.length)throw new Error('No settled BTC15M markets returned; do NOT substitute synthetic data.');
const recovered=[];
let errors=0, completed=0;
const results=new Array(markets.length);
let next=0;
async function worker(){
 while(true) {
  const i=next++;
  if(i>=markets.length)break;
  const market=markets[i];
  const start=Math.floor(Date.parse(market.open_time)/1000),end=Math.floor(Date.parse(market.close_time)/1000);
  const path='/series/'+SERIES+'/markets/'+encodeURIComponent(market.ticker)+
    '/candlesticks?start_ts='+(start+60)+'&end_ts='+(end+60)+'&period_interval=1';
  try {
   const data=await get(path);
   results[i]={market,candles:data.candlesticks??[]};
  }catch(e){
   errors++;
   results[i]={market,candles:[]};
   if(errors<=3)console.log('DATA_WARNING',market.ticker,e.message);
  }
  completed++;
  await sleep(370);
 }
}
await Promise.all([worker(),worker()]);
const clean=results.filter(Boolean);
const midpoint=Math.floor(clean.length/2);
const older=clean.slice(0,midpoint),newer=clean.slice(midpoint);
console.log('MARKET_SOURCE',JSON.stringify({
 series:SERIES,dataRange,marketsRequested:MARKET_LIMIT,marketCount:clean.length,
 candleFetchFailures:errors,marketsWithAnyCandles:clean.filter(x=>x.candles.length).length,
 firstMarketClose:clean[0]?.market.close_time,lastMarketClose:clean.at(-1)?.market.close_time,
 risk:KALSHI_BASELINE_CONFIG,realData:true,noOrders:true,
}));
for(const mode of ['momentum','reversal']){
 const olderR=scoreHistorical(older,mode),newerR=scoreHistorical(newer,mode);
 const whole=scoreHistorical(clean,mode);
 function summary(r){
  const {trades, ...rest}=r;
  return {...rest,last5Trades:trades.slice(-5)};
 }
 console.log('RESULT_JSON',JSON.stringify({mode,half:'older',...summary(olderR)}));
 console.log('RESULT_JSON',JSON.stringify({mode,half:'newer-untouched',...summary(newerR)}));
 console.log('RESULT_JSON',JSON.stringify({mode,half:'all',...summary(whole)}));
 const stress=scoreHistorical(clean,mode,{...KALSHI_BASELINE_CONFIG,slippageDollars:0.03});
 console.log('STRESS_JSON',JSON.stringify({mode,half:'all',slippageDollarsPerContract:0.03,...summary(stress)}));
}
console.log('CAUTION: These are retrospective, quote-based hypothetical fills, not actual orders or guaranteed executable prices.');
