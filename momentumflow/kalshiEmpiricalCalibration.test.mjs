import test from 'node:test';
import assert from 'node:assert/strict';
import { trainCalibration, evaluateHoldout, prepareCalibratedMarket } from './kalshiEmpiricalCalibration.js';

function row(price, won, n=0) {
  return {
    ticker:'TEST-'+n,close_time:new Date(Date.UTC(2026,0,1,0,n%60)).toISOString(),
    side:'yes',price,result:won?'yes':'no',won
  };
}
test('training does not inspect holdout wins or losses',()=>{
  const train=Array.from({length:100},(_,i)=>row(.5,i<75,i));
  const model=trainCalibration(train);
  const holdout=[row(.5,false,40),row(.5,true,41)];
  const wins=evaluateHoldout(holdout,model);
  const losses=evaluateHoldout(holdout.map(x=>({...x,won:false,result:'no'})),model);
  assert.deepEqual(model,trainCalibration(train));
  assert.equal(wins.trades,2);assert.equal(losses.trades,2);
  assert.ok(wins.netPnl>losses.netPnl);
});
test('sparse buckets reject rather than invent a likely winner',()=>{
  const model=trainCalibration([row(.55,true,1)]);
  const result=evaluateHoldout([row(.55,true,2)],model);
  assert.equal(result.trades,0);assert.equal(result.winRatePct,null);
  assert.equal(result.rejects['sparse-training-bucket'],1);
});
test('well-calibrated price refuses unconvincing net edge',()=>{
  const model=trainCalibration(Array.from({length:100},(_,i)=>row(.55,i<60,i)));
  const result=evaluateHoldout([row(.55,true)],model);
  assert.equal(result.trades,0);
  assert.equal(result.rejects['unconvincing-priced-edge'],1);
});
test('no-lookahead minute-8 signal construction from real-form candles',()=>{
  const open=Date.parse('2026-01-02T12:00:00Z')/1000;
  const candle=(minute,price,bid,ask)=>({
    end_period_ts:open+minute*60,
    price:{close:String(price)},
    yes_bid:{close:String(bid)},
    yes_ask:{close:String(ask)},
    volume:'100',
  });
  const market={ticker:'TEST',open_time:'2026-01-02T12:00:00Z',close_time:'2026-01-02T12:15:00Z',result:'no'};
  const c=[candle(4,.44,.42,.46),candle(7,.49,.47,.51),candle(8,.53,.52,.55)];
  const decision=prepareCalibratedMarket({market,candles:c});
  assert.equal(decision.skip,undefined);assert.equal(decision.price,.55);
  assert.equal(decision.side,'yes'); assert.equal(decision.won,false);
  const future=candle(12,.99,.98,1);
  assert.deepEqual(decision,prepareCalibratedMarket({market,candles:[...c,future]}));
});
test('risk sized including fee and slippage',()=>{
  const model=trainCalibration(Array.from({length:100},(_,i)=>row(.35,i<90,i)));
  const result=evaluateHoldout([row(.35,true)],model);
  assert.equal(result.trades,1);assert.ok(result.tradeLog[0].contracts*(.35+.01)+result.tradeLog[0].fee<=5+1e-7);
});
