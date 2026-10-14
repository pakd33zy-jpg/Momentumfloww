/*
 * Historical Kalshi BTC15M evaluation. Actual settled markets + timestamped
 * Kalshi orderbook quote candles. No real/demo account, no order placement.
 * This intentionally freezes TWO naïve strategies: follow quote momentum or
 * fade it. Neither is advertised as having an edge.
 */
export const KALSHI_BASELINE_CONFIG = Object.freeze({
  initialBalance: 1000,
  maxStakeDollars: 5,
  maxRiskFraction: 0.01,
  minAsk: 0.10,
  maxAsk: 0.85,
  maxSpread: 0.10,
  signalThreshold: 0.04,
  slippageDollars: 0.01,
  feeRate: 0.07,
});

const n = v => v === null || v === undefined || v === '' ? NaN : Number(v);
const round = v => Number(v.toFixed(4));
const close = (c,k) => n(c?.[k]?.close_dollars ?? c?.[k]?.close);
const secs = s => Date.parse(s)/1000;
const ctime = c => Number(c?.end_period_ts);

export function candidateFromCandles(market, candles, mode='momentum', cfg=KALSHI_BASELINE_CONFIG) {
  if (!['momentum', 'reversal'].includes(mode)) throw new Error('unknown baseline');
  if (!market || !['yes','no'].includes(market.result)) return {skip:'unsettled'};
  const open=secs(market.open_time), end=secs(market.close_time);
  if (!Number.isFinite(open)|| !Number.isFinite(end) || Math.abs(end-open-900)>5) return {skip:'bad-time-span'};
  const rows=Array.isArray(candles)?candles:[];
  // Both signal candles precede the assumed minute-8 entry. No later bar
  // (and never the settlement result) influences which side is bought.
  const early=rows.find(c=>ctime(c)===open+4*60);
  const late=rows.find(c=>ctime(c)===open+7*60);
  const entry=rows.find(c=>ctime(c)===open+8*60);
  if (!early||!late||!entry) return {skip:'missing-quote-bars'};
  const p0=close(early,'price'),p1=close(late,'price');
  if (!Number.isFinite(p0)||!Number.isFinite(p1)) return {skip:'missing-price-signal'};
  const change=p1-p0;
  if (Math.abs(change)<cfg.signalThreshold) return {skip:'no-signal'};
  const side=(change>0)===(mode==='momentum')?'yes':'no';
  const bid=close(entry,'yes_bid'),ask=close(entry,'yes_ask');
  if (![bid,ask].every(Number.isFinite)||bid<0||ask>1||ask<bid) return {skip:'invalid-quote'};
  if (ask-bid>cfg.maxSpread) return {skip:'wide-spread'};
  const price=side==='yes'?ask:1-bid;
  if (price<cfg.minAsk||price>cfg.maxAsk) return {skip:'outside-price-band'};
  if (!(n(entry?.volume_fp??entry?.volume)>0)) return {skip:'no-entry-volume'};
  return {side,price,spread:ask-bid,signalMove:change,ticker:market.ticker,
    result:market.result, close_time:market.close_time};
}
export function feeDollars(qty,price,cfg=KALSHI_BASELINE_CONFIG){
  return Math.ceil((cfg.feeRate*qty*price*(1-price)-1e-10)*100)/100;
}
export function scoreHistorical(marketsWithCandles,mode='momentum',cfg=KALSHI_BASELINE_CONFIG){
  let balance=cfg.initialBalance,peak=balance,drawdown=0,wins=0,losses=0,gw=0,gl=0;
  const skipped={}, trades=[];
  const rows=[...marketsWithCandles].sort((a,b)=>secs(a.market.close_time)-secs(b.market.close_time));
  for(const {market,candles} of rows){
    const signal=candidateFromCandles(market,candles,mode,cfg);
    if(signal.skip){skipped[signal.skip]=(skipped[signal.skip]||0)+1;continue;}
    const riskCap=Math.min(cfg.maxStakeDollars,balance*cfg.maxRiskFraction);
    const unitCost=signal.price+cfg.slippageDollars;
    // Fees are quantity dependent; require TOTAL outlay within risk cap.
    let qty=Math.min(100,Math.floor(riskCap/unitCost));
    while(qty>0 && qty*unitCost+feeDollars(qty,signal.price,cfg)>riskCap+1e-9)qty--;
    if(qty===0){skipped['risk-budget-too-small']=(skipped['risk-budget-too-small']||0)+1;continue;}
    const fee=feeDollars(qty,signal.price,cfg);
    const cost=qty*unitCost+fee;
    const won=signal.side===signal.result;
    const pnl=qty*(won?1:0)-cost;
    balance+=pnl;
    peak=Math.max(peak,balance);
    drawdown=Math.max(drawdown,(peak-balance)/peak*100);
    if(won){wins++;gw+=pnl}else{losses++;gl+=-pnl}
    trades.push({
      ticker:signal.ticker,close_time:signal.close_time,side:signal.side,
      quotedAsk:round(signal.price),fees:round(fee),
      qty,won,pnl:round(pnl),balance:round(balance),signalMove:round(signal.signalMove)
    });
  }
  return {
    strategy:mode,signalThreshold:cfg.signalThreshold,
    source:'Kalshi production settled markets / one-minute quote candles',
    execution:'indicative quote-close; not guaranteed executable',
    marketCount:rows.length,eligibleTrades:trades.length,wins,losses,
    winRatePct:trades.length?round(wins/trades.length*100):null,
    pnlDollars:round(balance-cfg.initialBalance),endingBalance:round(balance),
    returnPct:round((balance/cfg.initialBalance-1)*100),
    profitFactor:gl>0?round(gw/gl):gw>0?'undefined-no-losses':null,
    maxDrawdownPct:round(drawdown),skipped,trades
  };
}
