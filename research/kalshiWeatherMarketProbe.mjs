/**
 * Kalshi daily temperature public data feasibility study.
 * Reads metadata, recent outcomes and archived outcomes only.
 * NO API keys, NO orders, NO positions, NO strategy deployment.
 */
const BASE = 'https://external-api.kalshi.com/trade-api/v2';
const SERIES=['KXHIGHNY','KXHIGHLAX','KXHIGHCHI'];
const fetchJson=async(path)=>{
  const r=await fetch(BASE+path,{method:'GET',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('HTTP '+r.status+' from '+path.split('?')[0]);
  return r.json();
};
for(const ticker of SERIES){
  const report={series:ticker};
  try{
    const meta=await fetchJson('/series/'+ticker);
    const x=meta.series??{};
    report.category=x.category??null;
    report.frequency=x.frequency??null;
    report.title=x.title??null;
    const rules=String(x.rules_primary??'').replace(/\s+/g,' ').slice(0,360);
    report.settlementRuleExcerpt=rules;
  }catch(e){report.seriesError=String(e.message)}
  for(const [label,path] of [
    ['recent','/markets?status=settled&series_ticker='+ticker+'&limit=100'],
    ['archive','/historical/markets?series_ticker='+ticker+'&limit=100']
  ]){
    try{
      const x=await fetchJson(path);
      const a=x.markets??[];
      const settled=a.filter(m=>m.result==='yes'||m.result==='no');
      const events=new Set(a.map(m=>m.event_ticker).filter(Boolean));
      const vol=a.map(m=>Number(m.volume_fp??m.volume??0)).filter(Number.isFinite);
      report[label]={
        contractCount:a.length,eventsCount:events.size,settledCount:settled.length,
        pageHasMore:Boolean(x.cursor),
        contractsWithVolume:vol.filter(v=>v>0).length,
        volumeMedian:vol.length?vol.slice().sort((a,b)=>a-b)[Math.floor(vol.length/2)]:null,
        sample:settled.slice(0,2).map(m=>({
          ticker:m.ticker,result:m.result,open_time:m.open_time,
          close_time:m.close_time,settlement_time:m.settlement_ts,
          rules_excerpt:String(m.rules_primary??'').slice(0,260),
          strike_type:m.strike_type??null,
          floor_strike:m.floor_strike??null,cap_strike:m.cap_strike??null,
        })),
      };
    }catch(e){report[label]={error:String(e.message)}}
  }
  console.log('KALSHI_WEATHER_FEASIBILITY',JSON.stringify(report));
}
console.log('CAUTION: Series rules may change with time; check each historical market settlement rules before using a weather forecast.');
