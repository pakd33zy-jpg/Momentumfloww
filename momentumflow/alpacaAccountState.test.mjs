import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateAlpacaAccountAccess } from './alpacaAccountState.js';

test('allows an active unblocked Alpaca account', () => {
  assert.deepEqual(
    evaluateAlpacaAccountAccess({
      status: 'ACTIVE',
      account_blocked: false,
      trading_blocked: false,
      trade_suspended_by_user: false,
    }),
    { allowed: true, reason: null }
  );
});

test('blocks a closed Alpaca account', () => {
  assert.deepEqual(
    evaluateAlpacaAccountAccess({ status: 'ACCOUNT_CLOSED' }),
    {
      allowed: false,
      reason: 'Alpaca account status is ACCOUNT_CLOSED.',
    }
  );
});

test('blocks active accounts with any Alpaca trading restriction', () => {
  for (const field of [
    'account_blocked',
    'trading_blocked',
    'trade_suspended_by_user',
  ]) {
    const result = evaluateAlpacaAccountAccess({
      status: 'ACTIVE',
      [field]: true,
    });

    assert.equal(result.allowed, false);
    assert.match(result.reason, new RegExp(field));
  }
});

test('blocks accounts whose status is missing', () => {
  assert.deepEqual(evaluateAlpacaAccountAccess({}), {
    allowed: false,
    reason: 'Alpaca account status is unavailable.',
  });
});
