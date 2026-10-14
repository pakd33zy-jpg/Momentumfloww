import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { createKalshiDemoReadOnly, demoSignedHeaders, KALSHI_DEMO_ORIGIN } from './kalshiDemoReadOnly.js';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const keyId = 'demo-test-key-id';

test('Ed25519 headers verify and exclude query string', () => {
  const timestamp = 1770700000000;
  const path = '/trade-api/v2/portfolio/balance?limit=5';
  const h = demoSignedHeaders({ keyId, privateKeyPem: pem, path, timestamp });
  assert.equal(h['KALSHI-ACCESS-TIMESTAMP'], String(timestamp));
  assert.equal(h['KALSHI-ACCESS-KEY'], keyId);
  assert.equal(verify(null,
    Buffer.from(String(timestamp) + 'GET/trade-api/v2/portfolio/balance'),
    publicKey, Buffer.from(h['KALSHI-ACCESS-SIGNATURE'], 'base64')), true);
});

test('Escaped newline PEM works for Render configuration', () => {
  const h = demoSignedHeaders({
    keyId, privateKeyPem: pem.replace(/\n/g, '\\n'),
    path: '/trade-api/v2/portfolio/balance',
  });
  assert.ok(h['KALSHI-ACCESS-SIGNATURE']);
});

test('Public market fetch remains demo-only and sends no secret', async () => {
  const calls = [];
  const api = createKalshiDemoReadOnly({
    keyId, privateKeyPem: pem,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ markets: [] }) };
    },
  });
  await api.getMarkets({ limit: 10, status: 'open', seriesTicker: 'KXBTC15M' });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith(KALSHI_DEMO_ORIGIN));
  assert.ok(calls[0].url.includes('series_ticker=KXBTC15M'));
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(Object.keys(calls[0].options.headers).length, 0);
});

test('Demo verification is GET-only and signs balance request', async () => {
  const calls = [];
  const api = createKalshiDemoReadOnly({
    keyId, privateKeyPem: pem,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ balance: 12345 }) };
    },
  });
  assert.deepEqual(await api.verifyDemoCredentials(), {
    connected: true, demoBalanceDollars: 123.45,
  });
  assert.equal(calls[0].options.method, 'GET');
  assert.ok(calls[0].url.includes('/portfolio/balance'));
  assert.ok(calls[0].options.headers['KALSHI-ACCESS-SIGNATURE']);
  assert.ok(!calls[0].url.includes('kalshi.com/trade'));
});

test('Valid 1 minute historical quote request stays on demo endpoint', async () => {
  const calls = [];
  const api = createKalshiDemoReadOnly({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ candlesticks: [] }) };
    },
  });
  await api.getCandlesticks({
    seriesTicker: 'KXBTC15M',
    ticker: 'KXBTC15M-TEST-123',
    startTs: 1740000000, endTs: 1740000900, interval: 1,
  });
  assert.equal(new URL(calls[0].url).host, 'external-api.demo.kalshi.co');
  assert.equal(new URL(calls[0].url).searchParams.get('period_interval'), '1');
});

test('Invalid page size and request interval are rejected', async () => {
  const api = createKalshiDemoReadOnly({ fetchImpl: async () => { throw new Error('should not fetch'); } });
  await assert.rejects(api.getMarkets({ limit: 999 }), /page size/);
  await assert.rejects(api.getCandlesticks({
    seriesTicker: 'X', ticker: 'Y', startTs: 1, endTs: 2, interval: 5,
  }), /interval/);
});

test('Missing credentials fail locally before contacting demo', async () => {
  const api = createKalshiDemoReadOnly({
    keyId: '', privateKeyPem: '',
    fetchImpl: async () => { throw new Error('should not fetch'); },
  });
  await assert.rejects(api.verifyDemoCredentials(), /Missing demo API key ID/);
});
