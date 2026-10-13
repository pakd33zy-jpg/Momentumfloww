import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAlphaInsider } from './alphainsiderVerify.js';

test('missing key prevents any request', async () => {
  const previous = process.env.ALPHAINSIDER_API_KEY;
  delete process.env.ALPHAINSIDER_API_KEY;
  try {
    const result = await verifyAlphaInsider({ fetchImpl: () => { throw new Error('should not call'); } });
    assert.deepEqual(result, { ok: false, status: 'missing_key' });
  } finally {
    if (previous === undefined) delete process.env.ALPHAINSIDER_API_KEY;
    else process.env.ALPHAINSIDER_API_KEY = previous;
  }
});

test('verification uses GET with raw token and returns only safe status', async () => {
  const previous = process.env.ALPHAINSIDER_API_KEY;
  process.env.ALPHAINSIDER_API_KEY = 'TEST_ONLY_KEY';
  try {
    const result = await verifyAlphaInsider({ fetchImpl: async (url, options) => {
      assert.equal(url, 'https://alphainsider.com/api/verifyToken');
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.Authorization, 'TEST_ONLY_KEY');
      assert.equal(options.redirect, 'error');
      return { ok: true, json: async () => ({ success: true, response: { token: 'DO_NOT_EXPOSE' } }) };
    } });
    assert.deepEqual(result, { ok: true, status: 'verified' });
  } finally {
    if (previous === undefined) delete process.env.ALPHAINSIDER_API_KEY;
    else process.env.ALPHAINSIDER_API_KEY = previous;
  }
});

test('API rejection redacts any response', async () => {
  const previous = process.env.ALPHAINSIDER_API_KEY;
  process.env.ALPHAINSIDER_API_KEY = 'TEST_ONLY_KEY';
  try {
    const result = await verifyAlphaInsider({ fetchImpl: async () => ({
      ok: true, json: async () => ({ success: false, response: 'DO_NOT_EXPOSE' }),
    }) });
    assert.deepEqual(result, { ok: false, status: 'api_rejected' });
  } finally {
    if (previous === undefined) delete process.env.ALPHAINSIDER_API_KEY;
    else process.env.ALPHAINSIDER_API_KEY = previous;
  }
});
