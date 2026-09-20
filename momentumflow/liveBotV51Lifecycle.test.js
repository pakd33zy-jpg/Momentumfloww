import test from 'node:test';
import assert from 'node:assert/strict';
import { isManagedExecutionStrategy } from './liveBotV35.js';

test('managed paper lifecycle includes V35 equity and V51 crypto execution trades', () => {
  assert.equal(isManagedExecutionStrategy('EQUITY_V35_STANDALONE'), true);
  assert.equal(isManagedExecutionStrategy('CRYPTO_V51_PAPER_FORWARD'), true);
});

test('managed paper lifecycle excludes research-only and unrelated strategies', () => {
  assert.equal(isManagedExecutionStrategy('CRYPTO_V51_SHADOW'), false);
  assert.equal(isManagedExecutionStrategy('V50_PAPER'), false);
  assert.equal(isManagedExecutionStrategy(''), false);
});
