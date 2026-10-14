import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateForecast, paperBacktest } from './kalshiEdgePaper.js';
const common = {
  ticker: 'TEST-YES',
  forecastProbabilityYes: 0.70, yesAsk: 0.55, noAsk: 0.47,
  yesFee: 0.02, noFee: 0.02,
  forecastCreatedAt: '2026-01-01T11:00:00Z',
  quoteObservedAt: '2026-01-01T11:01:00Z',
  closeTime: '2026-01-01T18:00:00Z',
  result: 'yes',
};
test('finds net-positive expected value, not only high win probability', () => {
  const v = evaluateForecast(common);
  assert.equal(v.eligible, true);
  assert.equal(v.side, 'yes');
  assert.equal(v.expectedNetDollarsPerContract, 0.13);
});
test('rejects high likelihood when overpriced after fees', () => {
  const v = evaluateForecast({ ...common, forecastProbabilityYes: 0.90, yesAsk: 0.94, noAsk: 0.08 });
  assert.equal(v.eligible, false);
  assert.equal(v.reason, 'no-edge-after-fees');
});
test('can select NO if probability warrants it', () => {
  const v = evaluateForecast({ ...common, forecastProbabilityYes: 0.15, yesAsk: 0.72, noAsk: 0.24 });
  assert.equal(v.eligible, true);
  assert.equal(v.side, 'no');
});
test('rejects quotes after close or forecasts from future', () => {
  assert.equal(evaluateForecast({ ...common, quoteObservedAt: '2026-01-02T00:00:00Z' }).reason, 'time-order-unsafe');
  assert.equal(evaluateForecast({ ...common, forecastCreatedAt: '2026-01-01T11:03:00Z' }).reason, 'time-order-unsafe');
});
test('requires explicit fees, never assumes free trade', () => {
  assert.equal(evaluateForecast({ ...common, yesFee: undefined }).reason, 'missing-probability-quote-or-fees');
});
test('fixed-fraction capital cap; wins and losses both appear in backtest', () => {
  const r = paperBacktest([common, { ...common, ticker: 'TEST-LOSS', result: 'no', quoteObservedAt: '2026-01-01T11:02:00Z' }]);
  assert.equal(r.tradesExecuted, 2);
  assert.equal(r.wins, 1);
  assert.equal(r.losses, 1);
  assert.ok(r.trades.every(t => t.entryCost <= 10.5));
  assert.ok(r.pnl < 0);
});
test('does not claim profitability when there are no eligible trades', () => {
  const r = paperBacktest([{ ...common, yesAsk: 0.75, noAsk: 0.35 }]);
  assert.equal(r.tradesExecuted, 0);
  assert.equal(r.winRatePct, null);
});
