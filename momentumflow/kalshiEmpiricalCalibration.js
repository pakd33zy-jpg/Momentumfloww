/**
 * Frozen, train-only empirical calibration for historical BTC15M momentum
 * contract trades. Research only. Never places orders.
 *
 * This DOES NOT use settlement results from the heldout records to choose bets.
 * Restricts strategies to MOMENTUM signals: NO reversal parameter mining.
 */
import { candidateFromCandles, feeDollars, KALSHI_BASELINE_CONFIG } from './kalshi15mBacktestCore.js';

export const CALIBRATION = Object.freeze({
  minBucketObservations: 25,
  priorStrength: 20,
  zLowerBound: 1.0,
  minEdge: 0.02,
  bucketWidth: 0.20,
  maxStakeDollars: 5,
  maxRiskFraction: 0.01,
  slip: 0.01,
  initialBalance: 1000,
  minHoldoutTrades: 30,
});

const round = n => Number(n.toFixed(4));
const bucket = price => Math.max(0,Math.min(4,Math.floor((price - 0.10) / CALIBRATION.bucketWidth)));

function scoredMarket(item) {
  const signal = candidateFromCandles(item?.market, item?.candles, 'momentum');
  if (signal.skip) return { skip: signal.skip };
  return {
    ticker: signal.ticker,
    close_time: signal.close_time,
    side: signal.side,
    price: signal.price,
    result: signal.result,
    bucket: bucket(signal.price),
    won: signal.side === signal.result,
  };
}
export function prepareCalibratedMarket(item) { return scoredMarket(item); }

export function trainCalibration(training, config = CALIBRATION) {
  const bins = Array.from({length:5},()=>({n:0,wins:0,sumAsk:0}));
  let ignored=0;
  for(const row of training) {
    if(!row||row.skip||!Number.isFinite(row.price)||!['yes','no'].includes(row.result)) {ignored++;continue;}
    const b=bins[bucket(row.price)];
    b.n++; b.wins+=Number(row.won); b.sumAsk+=row.price;
  }
  return Object.freeze({
    source: 'training outcomes only; never test-fold outcomes',
    nTraining:training.length,
    ignored,
    bins: bins.map((b,i)=>{
      if(!b.n)return {bin:i,n:0,trainWinRate:null,meanQuote:null,postMean:null,conservativeProbability:null};
      const quote=b.sumAsk/b.n;
      const mean=(b.wins + config.priorStrength*quote) / (b.n + config.priorStrength);
      const std=Math.sqrt(mean*(1-mean)/(b.n+config.priorStrength));
      return {
        bin:i,n:b.n,trainWinRate:round(b.wins/b.n),meanQuote:round(quote),
        postMean:round(mean),
        conservativeProbability:round(Math.max(0, mean-config.zLowerBound*std)),
      };
    }),
  });
}

export function evaluateHoldout(holdout, calibration, config=CALIBRATION) {
  if(!calibration?.bins||calibration.bins.length!==5) throw Error('Invalid train-only calibration');
  let equity=config.initialBalance,peak=equity,maxDD=0,wins=0,losses=0,grossWins=0,grossLosses=0;
  const trades=[],rejects={};
  const ordered=[...holdout].sort((a,b)=>Date.parse(a?.close_time||0)-Date.parse(b?.close_time||0));
  function reject(reason){rejects[reason]=(rejects[reason]||0)+1;}
  for(const r of ordered){
    if(!r||r.skip){reject(r?.skip||'invalid');continue}
    // Guard against leaked inputs. Each record must be settled and timestamped.
    if(!Number.isFinite(Date.parse(r.close_time))||!['yes','no'].includes(r.result)){reject('incomplete');continue}
    const b=calibration.bins[bucket(r.price)];
    if(b.n<config.minBucketObservations){reject('sparse-training-bucket');continue}
    const worstCost=r.price+config.slip+feeDollars(1,r.price,KALSHI_BASELINE_CONFIG);
    const edge=b.conservativeProbability-worstCost;
    if(edge<config.minEdge){reject('unconvincing-priced-edge');continue}
    const riskCap=Math.min(config.maxStakeDollars,equity*config.maxRiskFraction);
    let quantity=Math.min(100,Math.floor(riskCap/(r.price+config.slip)));
    while(quantity>0 &&
      quantity*(r.price+config.slip)+feeDollars(quantity,r.price,KALSHI_BASELINE_CONFIG)>riskCap+1e-8)quantity--;
    if(quantity<1){reject('below-risk-cap');continue}
    const fee=feeDollars(quantity,r.price,KALSHI_BASELINE_CONFIG);
    const cost=quantity*(r.price+config.slip)+fee;
    const pnl=(r.won?quantity:0)-cost;
    equity+=pnl;
    peak=Math.max(peak,equity);maxDD=Math.max(maxDD,(peak-equity)/peak*100);
    if(r.won){wins++;grossWins+=pnl}else{losses++;grossLosses-=pnl}
    trades.push({
      ticker:r.ticker, close_time:r.close_time, side:r.side, price:r.price, bin:bucket(r.price),
      estimatedEdgePerContract:round(edge), contracts:quantity, fee:round(fee),
      won:r.won, pnl:round(pnl), balance:round(equity),
    });
  }
  return {
    method:'frozen empirical Kalshi YES/NO probability calibration; momentum side only',
    sample:holdout.length, trades:trades.length, wins, losses,
    winRatePct:trades.length?round(wins/trades.length*100):null,
    initialBalance:config.initialBalance, endingBalance:round(equity),
    netPnl:round(equity-config.initialBalance),
    returnPct:round((equity/config.initialBalance-1)*100),
    profitFactor:grossLosses>0?round(grossWins/grossLosses):null,
    maxDrawdownPct:round(maxDD), rejects,tradeLog:trades,
  };
}
