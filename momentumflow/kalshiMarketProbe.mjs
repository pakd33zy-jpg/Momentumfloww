// Read-only investigation of public real Kalshi market data.
// Never uses API keys, demo balance, or order endpoints.
const base='https://external-api.kalshi.com/trade-api/v2';
const signal=AbortSignal.timeout(12000);
async function read(path) {
 const response=await fetch(base+path,{method:'GET',signal});
 if(!response.ok) throw new Error('Kalshi public data '+response.status+' from '+path.split('?')[0]);
 return response.json();
}
for(const [kind,path] of [
 ['recent','/markets?status=settled&series_ticker=KXBTC15M&limit=3'],
 ['archived','/historical/markets?series_ticker=KXBTC15M&limit=3']]) {
 try {
  const data=await read(path);
  console.log('MARKETS',kind, 'count', data.markets?.length, 'cursor',Boolean(data.cursor));
  for(const m of (data.markets??[])) {
   const fields={ticker:m.ticker,status:m.status,result:m.result,open_time:m.open_time,close_time:m.close_time,settlement_ts:m.settlement_ts,volume_fp:m.volume_fp,market_type:m.market_type};
   console.log('MARKET',JSON.stringify(fields));
   const start=Math.floor(Date.parse(m.open_time)/1000);
   const end=Math.floor(Date.parse(m.close_time)/1000);
   console.log('DURATION_SECS',end-start);
   if (Number.isFinite(start) && Number.isFinite(end)) {
    const endpoint=kind==='recent'
      ? '/series/KXBTC15M/markets/'+encodeURIComponent(m.ticker)+'/candlesticks'
      : '/historical/markets/'+encodeURIComponent(m.ticker)+'/candlesticks';
    try{
     const candles=await read(endpoint+'?start_ts='+Math.max(0,end-1200)+'&end_ts='+(end+60)+'&period_interval=1');
     console.log('CANDLES',kind,m.ticker,'count',candles.candlesticks?.length,'sample',JSON.stringify((candles.candlesticks??[]).slice(0,2)));
    }catch(e){console.log('CANDLE_ERROR',e.message);}
   }
   break;
  }
 }catch(e){console.log('MARKET_ERROR',kind,e.message);}
}
