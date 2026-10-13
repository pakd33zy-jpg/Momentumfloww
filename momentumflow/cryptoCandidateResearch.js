import express from 'express';
import { getCryptoBars } from './alpacaClient.js';

const router = express.Router();
const SYMBOLS = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'AVAX/USD', 'LTC/USD', 'BCH/USD', 'DOGE/USD'];

const n = (b, k) => Number(b?.[k] ?? b?.[{ o: 'open', h: 'high', l: 'low', c: 'close' }[k]] ?? 0);
function ema(a, p) { const out = Array(a.length).fill(null); if (a.length < p) return out; let x = a.slice(0, p).reduce((s,v)=>s+v,0)/p; out[p-1]=x; const k=2/(p+1); for(let i=p;i<a.length;i++){x=a[i]*k+x*(1-k);out[i]=x;} return out; }
function tr(rows) { return rows.map((b,i)=>i ? Math.max(n(b,'h')-n(b,'l'),Math.abs(n(b,'h')-n(rows[i-1],'c')),Math.abs(n(b,'l')-n(rows[i-1],'c'))) : n(b,'h')-n(b,'l')); }
function rma(a,p){const out=Array(a.length).fill(null);if(a.length<p)return out;let x=a.slice(0,p).reduce((s,v)=>s+v,0)/p;out[p-1]=x;for(let i=p;i<a.length;i++){x=(x*(p-1)+a[i])/p;out[i]=x;}return out;}
function dmi(rows,p=14){const plus=rows.map((b,i)=>i?Math.max(0,n(b,'h')-n(rows[i-1],'h')):0);const minus=rows.map((b,i)=>i?Math.max(0,n(rows[i-1],'l')-n(b,'l')):0);for(let i=1;i<rows.length;i++){if(plus[i]<=minus[i])plus[i]=0;if(minus[i]<=plus[i])minus[i]=0;}const atr=rma(tr(rows),p),ap=rma(plus,p),am=rma(minus,p);const pdi=atr.map((v,i)=>v?100*ap[i]/v:null),mdi=atr.map((v,i)=>v?100*am[i]/v:null);const dx=pdi.map((v,i)=>v!=null&&mdi[i]!=null&&v+mdi[i]?100*Math.abs(v-mdi[i])/(v+mdi[i]):null);return {pdi,mdi,adx:rma(dx.map(v=>v??0),p)};}
function summary(ts){const wins=ts.filter(x=>x.r>0),loss=ts.filter(x=>x.r<=0),gp=wins.reduce((s,x)=>s+x.r,0),gl=-loss.reduce((s,x)=>s+x.r,0);let eq=1,peak=1,dd=0;for(const x of ts){eq*=1+x.r;peak=Math.max(peak,eq);dd=Math.max(dd,1-eq/peak);}return{trades:ts.length,winRatePct:+(100*wins.length/Math.max(1,ts.length)).toFixed(2),profitFactor:gl?+(gp/gl).toFixed(3):gp?999:0,returnPct:+((eq-1)*100).toFixed(3),maxDrawdownPct:+(dd*100).toFixed(3)};}
function run(rows, cfg){const c=rows.map(x=>n(x,'c')), e20=ema(c,20),e50=ema(c,50),e200=ema(c,200),dm=dmi(rows),cost=.005,trades=[];let pos=null;for(let i=201;i<rows.length-1;i++){const next=n(rows[i+1],'o');if(!(next>0))continue;if(pos){let exit=false;if(cfg.kind==='ema')exit=e20[i]<e50[i];else if(cfg.kind==='dmi')exit=dm.pdi[i]<dm.mdi[i];else exit=c[i]<Math.min(...rows.slice(i-cfg.exit,i).map(x=>n(x,'l')));if(exit){trades.push({r:next*(1-cost/2)/pos-1});pos=null;}continue;}let enter=false;if(cfg.kind==='ema')enter=e20[i]>e50[i]&&e50[i]>e200[i]&&e20[i-1]<=e50[i-1];else if(cfg.kind==='dmi')enter=dm.pdi[i]>dm.mdi[i]&&dm.adx[i]>=25&&c[i]>e200[i];else enter=c[i]>Math.max(...rows.slice(i-cfg.entry,i).map(x=>n(x,'h')))&&c[i]>e200[i];if(enter)pos=next*(1+cost/2);}if(pos)trades.push({r:n(rows.at(-1),'c')*(1-cost/2)/pos-1});return trades;}

function runRotation(all, lookback, rebalanceDays, topN, exposure = 1) {
  const btc = all['BTC/USD'] || [];
  const btcClose = btc.map((b) => n(b, 'c'));
  const btcEma200 = ema(btcClose, 200);
  let held = [], equity = 1, peak = 1, maxDd = 0, winningDays = 0, losingDays = 0, turnoverEvents = 0;
  const daily = [];
  for (let i = 201; i < btc.length - 1; i += 1) {
    if ((i - 201) % rebalanceDays === 0) {
      const riskOn = btcClose[i] > btcEma200[i] && btcClose[i] > btcClose[i - lookback];
      const ranked = riskOn ? SYMBOLS.map((s) => {
        const rows = all[s] || [];
        return { s, m: rows[i] && rows[i - lookback] ? n(rows[i], 'c') / n(rows[i - lookback], 'c') - 1 : -Infinity };
      }).filter((x) => x.m > 0).sort((a,b) => b.m - a.m).slice(0, topN).map((x) => x.s) : [];
      const changed = new Set([...held, ...ranked]).size - held.filter((s) => ranked.includes(s)).length;
      if (changed) { equity *= 1 - exposure * 0.0025 * changed / Math.max(1, topN); turnoverEvents += 1; }
      held = ranked;
    }
    let r = 0;
    if (held.length) r = exposure * held.reduce((sum,s) => {
      const rows=all[s]||[]; const a=n(rows[i],'c'), b=n(rows[i+1],'c'); return sum + (a>0&&b>0 ? b/a-1 : 0);
    },0)/held.length;
    equity *= 1 + r; daily.push(r); if(r>0)winningDays++; else if(r<0)losingDays++;
    peak=Math.max(peak,equity); maxDd=Math.max(maxDd,1-equity/peak);
  }
  const gain=daily.filter(x=>x>0).reduce((a,b)=>a+b,0), loss=-daily.filter(x=>x<0).reduce((a,b)=>a+b,0);
  return { trades:turnoverEvents, winRatePct:+(100*winningDays/Math.max(1,winningDays+losingDays)).toFixed(2), profitFactor:loss?+(gain/loss).toFixed(3):gain?999:0, returnPct:+((equity-1)*100).toFixed(3), maxDrawdownPct:+(100*maxDd).toFixed(3) };
}

router.get('/crypto-candidates', async (req,res)=>{try{const days=Math.max(365,Math.min(1095,Math.floor(Number(req.query.days||730))));const end=req.query.end?new Date(String(req.query.end)):new Date();const start=new Date(end-days*86400000);const variants=[{id:'EMA_20_50_200',kind:'ema'},{id:'DMI_ADX25_EMA200',kind:'dmi'},{id:'TURTLE_20_10_EMA200',kind:'channel',entry:20,exit:10},{id:'TURTLE_55_20_EMA200',kind:'channel',entry:55,exit:20}];const all={};for(const s of SYMBOLS){const x=await getCryptoBars('paper',[s],{timeframe:'1Day',start,end,limit:10000,sort:'asc',maxPages:10});all[s]=x[s]||x[s.replace('/','')]||[];}const results=variants.map(v=>{const by={};let trades=[];for(const s of SYMBOLS){const t=run(all[s],v);trades.push(...t);by[s]={bars:all[s].length,...summary(t)};}return{id:v.id,aggregate:summary(trades),positiveSymbols:Object.values(by).filter(x=>x.returnPct>0).length,bySymbol:by};});const rotationResults=[{id:'ROTATION_20D_5D_TOP2',lookback:20,rebalance:5,topN:2},{id:'ROTATION_45D_7D_TOP2',lookback:45,rebalance:7,topN:2},{id:'ROTATION_60D_7D_TOP1',lookback:60,rebalance:7,topN:1},{id:'ROTATION_60D_7D_TOP2_50X',lookback:60,rebalance:7,topN:2,exposure:.5},{id:'ROTATION_60D_7D_TOP2_70X',lookback:60,rebalance:7,topN:2,exposure:.7},{id:'ROTATION_60D_7D_TOP2',lookback:60,rebalance:7,topN:2},{id:'ROTATION_60D_7D_TOP3',lookback:60,rebalance:7,topN:3},{id:'ROTATION_75D_7D_TOP2',lookback:75,rebalance:7,topN:2},{id:'ROTATION_90D_14D_TOP2',lookback:90,rebalance:14,topN:2}].map(v=>({id:v.id,aggregate:runRotation(all,v.lookback,v.rebalance,v.topN,v.exposure??1)}));res.json({researchOnly:true,start,end,days,costPct:.5,execution:'closed daily candle; next daily open; long/cash',results:[...results,...rotationResults]});}catch(e){res.status(500).json({error:e.message});}});

export default router;
