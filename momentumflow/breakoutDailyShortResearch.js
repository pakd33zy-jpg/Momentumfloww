import express from 'express';
import fetch from 'node-fetch';
import { getCredentials } from './alpacaClient.js';

const router = express.Router();
const SYMBOLS = [
  'SPY','QQQ','IWM','DIA','AAPL','MSFT','NVDA','AMZN','META','TSLA',
  'AMD','GOOGL','NFLX','AVGO','INTC','MU','ORCL','CRM','ADBE','PLTR',
  'JPM','BAC','WFC','GS','V','MA','XOM','CVX','COP','SLB',
  'WMT','COST','HD','LOW','DIS','NKE','UBER','ABNB','BA','CAT',
  'GE','F','GM','PFE','LLY','UNH','JNJ','KO','PEP','T',
  'XLK','XLF','XLE','XLV','XLY','XLP','XLI','XLU','XLB','XLC',
  'QCOM','TXN','AMAT','LRCX','KLAC','MRVL','CSCO','IBM','NOW','SNOW',
  'C','SCHW','MS','AXP','COF','OXY','MPC','PSX','HAL','EOG',
  'MCD','SBUX','TGT','TJX','BKNG','DE','UPS','RTX','LMT','HON',
  'ABBV','MRK','TMO','ABT','MDT','CMCSA','VZ','SHOP','SNAP','ROKU',
];
const DATA_BASE='https://data.alpaca.markets', ENTRY=55, EXIT=20, COST=0.04;

function headers(){ const c=getCredentials('paper'); if(!c) throw new Error('No Alpaca paper credentials configured.'); return {'APCA-API-KEY-ID':c.keyId,'APCA-API-SECRET-KEY':c.secretKey}; }
async function bars(symbol,start,end){
  const q=new URLSearchParams({timeframe:'1Day',start:start.toISOString(),end:end.toISOString(),feed:'iex',adjustment:'all',sort:'asc',limit:'10000'});
  const r=await fetch(`${DATA_BASE}/v2/stocks/${encodeURIComponent(symbol)}/bars?${q}`,{headers:headers()});
  const p=await r.json().catch(()=>({})); if(!r.ok) throw new Error(p?.message||`Bars failed ${symbol} (${r.status})`);
  return Array.isArray(p?.bars)?p.bars:[];
}
async function mapLimit(items,limit,worker){const out=new Array(items.length);let n=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(true){const i=n++;if(i>=items.length)return;out[i]=await worker(items[i]);}}));return out;}
function test(rows=[]){
  const x=rows.filter(b=>Number(b?.o)>0&&Number(b?.h)>0&&Number(b?.l)>0&&Number(b?.c)>0); if(x.length<ENTRY+5)return[];
  const o=x.map(b=>+b.o),h=x.map(b=>+b.h),l=x.map(b=>+b.l),c=x.map(b=>+b.c),side=COST/200,trades=[]; let pos=null;
  const close=(raw,i,reason)=>{const exit=raw*(1+side);const net=1-exit/pos.entry;trades.push({entryTime:x[pos.i]?.t||null,exitTime:x[i]?.t||null,netReturn:net,holdBars:Math.max(1,i-pos.i+1),reason});pos=null;};
  for(let i=ENTRY;i<x.length-1;i+=1){
    if(pos){const high20=Math.max(...h.slice(i-EXIT,i));if(c[i]>high20)close(o[i+1],i+1,'20_DAY_HIGH_BREAK');continue;}
    const low55=Math.min(...l.slice(i-ENTRY,i)); if(c[i]<low55)pos={entry:o[i+1]*(1-side),i:i+1};
  }
  if(pos)close(c[x.length-1],x.length-1,'END_MARK'); return trades;
}
function summarize(trades=[]){
  let eq=1,peak=1,dd=0,gw=0,gl=0,w=0,holds=0;
  for(const t of trades){const r=+t.netReturn||0;eq*=1+r;peak=Math.max(peak,eq);dd=Math.max(dd,peak>0?1-eq/peak:0);if(r>0){w++;gw+=r}else if(r<0)gl+=Math.abs(r);holds+=+t.holdBars||0;}
  return {trades:trades.length,wins:w,losses:trades.length-w,winRatePct:trades.length?+(w/trades.length*100).toFixed(2):0,returnPct:+((eq-1)*100).toFixed(3),profitFactor:gl>0?+(gw/gl).toFixed(3):(gw>0?999:0),maxDrawdownPct:+(dd*100).toFixed(3),avgTradePct:trades.length?+(trades.reduce((s,t)=>s+(+t.netReturn||0),0)/trades.length*100).toFixed(4):0,avgHoldBars:trades.length?+(holds/trades.length).toFixed(2):0};
}
function median(a=[]){if(!a.length)return 0;const x=[...a].sort((a,b)=>a-b),i=Math.floor(x.length/2);return +(x.length%2?x[i]:(x[i-1]+x[i])/2).toFixed(3);}
function aggregate(per,cutoff){
  const rows=Object.entries(per),all=rows.flatMap(([,v])=>v.trades),recent=all.filter(t=>new Date(t.entryTime||0).getTime()>=cutoff),returns=rows.map(([,v])=>v.summary.returnPct),rr=rows.map(([,v])=>v.recent.returnPct),mean=a=>a.length?+(a.reduce((s,n)=>s+n,0)/a.length).toFixed(3):0;
  const add=(s,vals,pos)=>({...s,equalWeightSymbolReturnPct:mean(vals),medianSymbolReturnPct:median(vals),positiveSymbols:pos,totalSymbols:rows.length,worstSymbolReturnPct:+Math.min(...vals).toFixed(3),bestSymbolReturnPct:+Math.max(...vals).toFixed(3)});
  return {all:add(summarize(all),returns,rows.filter(([,v])=>v.summary.returnPct>0).length),recent365d:add(summarize(recent),rr,rows.filter(([,v])=>v.recent.returnPct>0).length)};
}
router.get('/daily',async(req,res)=>{
  try{
    const days=Math.max(900,Math.min(1825,Math.floor(Number(req.query.days||1825)))),end=new Date(),start=new Date(end.getTime()-days*86400000),cutoff=end.getTime()-365*86400000;
    const fetched=await mapLimit(SYMBOLS,5,async s=>[s,await bars(s,start,end)]),per={};
    for(const [symbol,b] of fetched){const trades=test(b),recent=trades.filter(t=>new Date(t.entryTime||0).getTime()>=cutoff);per[symbol]={trades,summary:summarize(trades),recent:summarize(recent)};}
    const stats=aggregate(per,cutoff);res.set('Cache-Control','no-store');res.json({generatedAt:new Date().toISOString(),researchOnly:true,liveBotChanged:false,direction:'short-only',timeframe:'1Day',universe:'liquid100',days,adjustment:'all',modeledRoundTripCostPct:COST,rules:{entry:'close below prior 55-day low; short next open',exit:'close above prior 20-day high; cover next open'},tradesPerYearWholeWindow:+(stats.all.trades/(days/365)).toFixed(1),tradesLast365d:stats.recent365d.trades,aggregate:stats.all,recent365d:stats.recent365d});
  }catch(e){res.status(500).json({error:e.message});}
});
export default router;
