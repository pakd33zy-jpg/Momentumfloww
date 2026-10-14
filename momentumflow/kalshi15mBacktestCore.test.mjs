import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateFromCandles,scoreHistorical,feeDollars } from './kalshi15mBacktestCore.js';
const open='2026-10-14T21:45:00Z',close='2026-10-14T22:00:00Z';
const o=Date.parse(open)/1000;
const m={ticker:'EXAMPLE-UNITTEST',open_time:open,close_time:close,result:'yes'};
const candles=[
 {end_period_ts:o+240,price:{close_dollars:'0.40'}},
 {end_period_ts:o+420,price:{close_dollars:'0.54'}},
 {end_period_ts:o+480,yes_bid:{close_dollars:'0.56'},yes_ask:{close_dollars:'0.58'},volume_fp:'100'},
];
test('Uses earlier signal and 8th minute entry, excludes future bars',()=>{
 const a=candidateFromCandles(m,candles,'momentum');
 assert.equal(a.side,'yes');
 const b=candidateFromCandles(m,[...candles,{end_period_ts:o+600,price:{close_dollars:'0.001'}}],'momentum');
 assert.deepEqual(a,b);
});
test('No side uses complement of YES bid (not ask)',()=>{
 const a=candidateFromCandles(m,candles,'reversal');
 assert.equal(a.side,'no');assert.ok(Math.abs(a.price-0.44)<1e-9);
});
test('Wide spread and no volume fail closed',()=>{
 assert.equal(candidateFromCandles(m,candles.map(c=>c.end_period_ts===o+480?{...c,yes_ask:{close_dollars:'0.90'}}:c)).skip,'wide-spread');
 assert.equal(candidateFromCandles(m,candles.map(c=>c.end_period_ts===o+480?{...c,volume_fp:'0'}:c)).skip,'no-entry-volume');
});
test('Fee charge rounds up to nearest penny and counts quantity',()=>{
 assert.equal(feeDollars(1,0.50),0.02);
 assert.equal(feeDollars(10,0.50),0.18);
});
test('Paper scoring accounts for wins AND losses with genuine timestamps',()=>{
 const x=scoreHistorical([{market:m,candles},{market:{...m,ticker:'SECOND',result:'no',open_time:'2026-10-14T22:00:00Z',close_time:'2026-10-14T22:15:00Z'},
 candles:candles.map(c=>({...c,end_period_ts:c.end_period_ts+900}))}]);
 assert.equal(x.eligibleTrades,2);assert.equal(x.wins,1);assert.equal(x.losses,1);
 assert.ok(x.trades[0].fees>0);
});
test('Unsettled market never counts as settled result',()=>{
 assert.equal(candidateFromCandles({...m,result:''},candles).skip,'unsettled');
});
