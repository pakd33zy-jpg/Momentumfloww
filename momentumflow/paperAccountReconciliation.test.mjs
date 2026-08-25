import test from 'node:test';
import assert from 'node:assert/strict';

import { voidOpenPaperTradesAfterAccountReset } from './paperAccountReconciliation.js';

test('voids only open paper trades after a confirmed empty-account reset', () => {
  const sessions = [
    { id: 'paper-session', mode: 'paper' },
    { id: 'live-session', mode: 'live' },
  ];

  const trades = [
    {
      id: 'open-paper',
      session_id: 'paper-session',
      market: 'LTC/USD',
      entry_price: 60,
      result: null,
      pnl: null,
    },
    {
      id: 'closed-paper',
      session_id: 'paper-session',
      market: 'BTC/USD',
      entry_price: 80000,
      result: 'win',
      pnl: 2,
    },
    {
      id: 'open-live',
      session_id: 'live-session',
      market: 'SPY',
      entry_price: 500,
      result: null,
      pnl: null,
    },
  ];

  const result = voidOpenPaperTradesAfterAccountReset(
    trades,
    sessions,
    '2026-08-25T21:00:00.000Z'
  );

  assert.deepEqual(result.voidedTradeIds, ['open-paper']);
  assert.deepEqual(result.affectedSessionIds, ['paper-session']);

  const voided = result.trades.find((trade) => trade.id === 'open-paper');
  assert.equal(voided.result, 'void');
  assert.equal(voided.voided, true);
  assert.equal(voided.pnl, 0);
  assert.equal(voided.exit_price, 60);
  assert.equal(voided.account_reset_reconciled, true);

  assert.deepEqual(
    result.trades.find((trade) => trade.id === 'closed-paper'),
    trades[1]
  );
  assert.deepEqual(
    result.trades.find((trade) => trade.id === 'open-live'),
    trades[2]
  );
});
