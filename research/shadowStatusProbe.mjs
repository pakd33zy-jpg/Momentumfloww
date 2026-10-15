/**
 * Read-only diagnostics for running MomentumFlow paper/shadow strategies.
 * No keys, no order endpoints, no POST requests, no PII or positions printed.
 */
const ORIGIN='https://momentumfloww.onrender.com';
const endpoints={
  equities55x20:'/api/breakout-55-20-shadow/status',
  equityIndependent50:'/api/breakout-55-20-validation50-shadow/status',
  cryptoC62:'/api/c62-shadow/status',
  alpacaPaperBot:'/api/live-bot/status',
};
const n=x=>typeof x==='number' && Number.isFinite(x)?x:null;
for(const [name,path] of Object.entries(endpoints)){
  let report={name,endpoint:path};
  try{
    const response=await fetch(ORIGIN+path,{
      method:'GET',headers:{accept:'application/json'},
      signal:AbortSignal.timeout(55000),
    });
    report.http=response.status;
    if(response.ok){
      const x=await response.json();
      const perf=x.performance||{};
      const stats=x.strategyPerformance;
      report={
        ...report,
        running:x.running===true,
        mode:x.mode??null,
        placesOrders:x.placesOrders===true,
        lastTickAt:x.lastTickAt??null,
        lastTickAgeMinutes:x.lastTickAt?Math.round((Date.now()-Date.parse(x.lastTickAt))/60000):null,
        errorPresent:!!x.lastError,
        openCount:n(x.openPositionCount),
        shadowTrades:Array.isArray(x.closedTrades)?x.closedTrades.length:null,
        shadowOpenCount:x.positions&&typeof x.positions==='object'?Object.keys(x.positions).length:null,
        performance:{
          trades:n(perf.trades),
          wins:n(perf.wins),
          losses:n(perf.losses),
          profitFactor:n(perf.profitFactor),
          pnl:n(perf.pnl),
          returnPct:n(x.virtualPortfolio?.returnPct),
          maxDrawdownPct:n(x.virtualPortfolio?.maxDrawdownPct),
        },
        paperStrategies:Array.isArray(stats)?stats.map(y=>({
          strategy:y.strategy,tradeCount:n(y.trades),pnl:n(y.pnl),
          profitFactor:n(y.profitFactor),
        })).slice(0,10):null,
      };
    }else report.status='http-error';
  }catch(e){report.status='network-error';report.errorType=e.name??'unknown';}
  console.log('READ_ONLY_STRATEGY_HEALTH',JSON.stringify(report));
}
