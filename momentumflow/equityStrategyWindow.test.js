import test from 'node:test';
import assert from 'node:assert/strict';
import { equityStrategyWindowOpen } from './equityStrategyV20.js';

const eastern = (hour, minute) =>
  // August is EDT (UTC-4).
  new Date(Date.UTC(2026, 7, 25, hour + 4, minute));

test('does not scan equities during early premarket when no V20 setup is eligible', () => {
  assert.equal(equityStrategyWindowOpen({ now: eastern(4, 22) }), false);
});

test('starts equity scans when the first V20 setup window opens', () => {
  assert.equal(equityStrategyWindowOpen({ now: eastern(9, 34) }), false);
  assert.equal(equityStrategyWindowOpen({ now: eastern(9, 35) }), true);
});

test('stops equity scans after the final configured V20 window closes', () => {
  assert.equal(equityStrategyWindowOpen({ now: eastern(15, 45) }), true);
  assert.equal(equityStrategyWindowOpen({ now: eastern(15, 46) }), false);
});
