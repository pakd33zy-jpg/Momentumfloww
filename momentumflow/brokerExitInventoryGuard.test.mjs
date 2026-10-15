import test from 'node:test';
import assert from 'node:assert/strict';
import { planBrokerExit } from './brokerExitInventoryGuard.js';

const args = { symbol: 'BTC/USD', direction: 'LONG', recordedQty: '1', positions: [] };
test('missing broker position blocks a sell, never creates a short', () => {
  assert.deepEqual(planBrokerExit(args), { allowed: false, reason: 'broker-position-missing' });
});
test('sellable zero (e.g. pending order) prevents duplicate sell', () => {
  assert.equal(planBrokerExit({ ...args, positions: [{symbol:'BTCUSD', qty:'1', qty_available:'0'}] }).allowed, false);
});
test('valid long crypto uses held quantity, with harmless dust clamp', () => {
  const result = planBrokerExit({ ...args, positions: [{symbol:'BTCUSD', qty:'0.999999', qty_available:'0.999999'}] });
  assert.deepEqual(result, { allowed:true, side:'sell', qty:0.999999 });
});
test('substantial broker mismatch holds for reconciliation', () => {
  const result = planBrokerExit({ ...args, positions: [{symbol:'BTCUSD', qty:'0.7'}] });
  assert.equal(result.reason, 'broker-position-quantity-mismatch');
});
test('equity long cannot sell when broker position disappeared', () => {
  const result = planBrokerExit({ symbol:'AAPL',direction:'LONG',recordedQty:3,positions:[] });
  assert.equal(result.allowed,false);
});
test('short can only cover a real short position', () => {
  const a={symbol:'AAPL',direction:'SHORT',recordedQty:3,positions:[{symbol:'AAPL',qty:'-3'}]};
  assert.deepEqual(planBrokerExit(a), {allowed:true,side:'buy',qty:3});
  assert.equal(planBrokerExit({...a,positions:[{symbol:'AAPL',qty:'3'}]}).allowed,false);
  assert.equal(planBrokerExit({...a,positions:[]}).allowed,false);
});
test('broker unavailable or duplicated rows fail closed', () => {
  assert.equal(planBrokerExit({...args,positions:null}).allowed,false);
  assert.equal(planBrokerExit({...args,positions:[{symbol:'BTCUSD',qty:1},{symbol:'BTC/USD',qty:1}]}).allowed,false);
});
