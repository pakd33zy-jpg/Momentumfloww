import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalCandleDecision,paperPortfolio,simulatedTakerFee} from './kalshiHistoric15m.mjs';
const close='2026-01-06T12:15:00Z';
const start=Math.floor(Date.parse(close)/1000)-900;
const candle=(minute,bid,ask)=>({
  end_period_ts:start+minute*60,
  yes_bid:{close_dollars:String(bid)},
  yes_ask:{close_dollars:String(ask)},
});
const market={ticker:'KXBTC15M-TEST',result:'yes',open_time:'2026-01-06T12:00:00Z',close_time:close};
const candles=[
  candle(3,.43,.47),
  candle(4,.44,.48),
  candle(5,.46,.50),
  candle(6,.47,.51),
  candle(7,.49,.53),
  candle(8,.50,.54),
  candle(9,.95,.99),
];
test('reads only pre-entry market information, excludes future quote candle from signal',()=>{
  const a=historicalCandleDecision(market,candles);
  const b=historicalCandleDecision(market,[...candles.slice(0,-1),candle(9,.01,.02)]);
  assert.equal(a.skip,undefined);
  assert.equal(a.move,.06);
  assert.equal(a.yesAsk,.54);
  assert.equal(a.noAsk,.50);
  assert.deepEqual(a,b);
});
test('uses actual bid to price NO buys, not YES ask',()=>{
  assert.equal(historicalCandleDecision(market,candles).noAsk,.50);
});
test('requires pre-entry bid/ask, never fabricates price',()=>{
  assert.equal(historicalCandleDecision(market,candles.filter(c=>c.end_period_ts!==start+8*60)).skip,'missing-timestamped-candles');
});
test('taker fee rounded up to cent for total contracts',()=>{
  assert.equal(simulatedTakerFee(10,.5),.18);
});
test('risk budget includes slippage and fees, counts genuine binary outcome',()=>{
  const decision=historicalCandleDecision(market,candles);
  const r=paperPortfolio([decision],'momentum');
  assert.equal(r.trades,1);
  assert.equal(r.wins,1);
  assert.ok(r.tradeLog[0].stake<=10);
  assert.ok(r.netPnl>0);
  const loss=paperPortfolio([{...decision,result:'no'}],'momentum');
  assert.ok(loss.netPnl<0);
  assert.equal(loss.losses,1);
});
test('no eligible data reports no results instead of a perfect win rate',()=>{
  const r=paperPortfolio([],'momentum');
  assert.equal(r.trades,0);
  assert.equal(r.winRatePct,null);
  assert.equal(r.netPnl,0);
});
