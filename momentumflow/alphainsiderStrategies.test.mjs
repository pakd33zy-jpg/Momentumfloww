import test from 'node:test';
import assert from 'node:assert/strict';
import { searchAlphaInsiderPublicStrategies } from './alphainsiderStrategies.js';

test('POST search filters by type, year, top and caps limit', async () => {
  const result = await searchAlphaInsiderPublicStrategies({
    type: 'cryptocurrency', timeframe: 'year', limit: 100,
    token: 'TEST_TOKEN', fetchImpl: async (url, options) => {
      assert.equal(url, 'https://alphainsider.com/api/searchStrategies');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'TEST_TOKEN');
      assert.equal(options.redirect, 'error');
      assert.deepEqual(JSON.parse(options.body), {
        type: { includes: ['cryptocurrency'], excludes: [] }, timeframe: 'year', sort: 'top', limit: 20,
      });
      return { ok: true, json: async () => ({ success: true, response: [{
        strategy_id: 'test-id', name: 'Example',
        type: 'cryptocurrency', created_at: '2025-01-01T00:00:00Z',
        price: '0', subscriber_count: '12', secret: 'DO_NOT_RETURN',
        timeframes: [{ timeframe: 'year', rank_top: '2', rank_performance: '7',
          max_drawdown: '0.05', past_value: '1.12' }],
      }] }) };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.strategies, [{
    strategy_id: 'test-id', name: 'Example', type: 'cryptocurrency',
    created_at: '2025-01-01T00:00:00Z', price: 0, subscribers: 12,
    timeframe: 'year', rank_top: 2, rank_performance: 7,
    max_drawdown_fraction: 0.05,
  }]);
  assert.equal(JSON.stringify(result).includes('DO_NOT_RETURN'), false);
});

test('invalid filter never calls network', async () => {
  const result = await searchAlphaInsiderPublicStrategies({
    type: 'forex', fetchImpl: () => { throw new Error('must not run'); },
  });
  assert.deepEqual(result, { ok: false, status: 'invalid_filter' });
});

test('HTTP failure does not leak upstream response', async () => {
  const result = await searchAlphaInsiderPublicStrategies({
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ secret: 'hidden' }) }),
  });
  assert.deepEqual(result, { ok: false, status: 'http_error', httpStatus: 401 });
});
