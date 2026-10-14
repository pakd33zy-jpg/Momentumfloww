import { createPrivateKey, sign, constants } from 'node:crypto';

// SECURITY: this module talks ONLY to the Kalshi DEMO hostname, and permits
// ONLY GET requests. No order-entry functions or production host overrides.
export const KALSHI_DEMO_ORIGIN = 'https://external-api.demo.kalshi.co';
const ROOT = '/trade-api/v2';

function privateKeyFromPem(pem) {
  if (!pem || typeof pem !== 'string') throw new Error('Missing demo private key');
  // Render env vars may store PEM newlines as literal \n.
  return createPrivateKey(pem.replace(/\\n/g, '\n'));
}

export function demoSignedHeaders({ keyId, privateKeyPem, path, timestamp = Date.now() }) {
  if (!keyId || typeof keyId !== 'string') throw new Error('Missing demo API key ID');
  if (typeof path !== 'string' || !path.startsWith(ROOT + '/')) {
    throw new Error('Invalid demo signing path');
  }
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error('Invalid timestamp');
  const key = privateKeyFromPem(privateKeyPem);
  const text = String(timestamp) + 'GET' + path.split('?')[0];
  const payload = Buffer.from(text, 'utf8');
  let signature;
  if (key.asymmetricKeyType === 'ed25519') {
    signature = sign(null, payload, key);
  } else if (key.asymmetricKeyType === 'rsa' || key.asymmetricKeyType === 'rsa-pss') {
    signature = sign('sha256', payload, {
      key,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
    });
  } else {
    throw new Error('Unsupported demo API key type');
  }
  return {
    'KALSHI-ACCESS-KEY': keyId,
    'KALSHI-ACCESS-TIMESTAMP': String(timestamp),
    'KALSHI-ACCESS-SIGNATURE': signature.toString('base64'),
  };
}

function demoPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new Error('Invalid demo path');
  }
  // Strict GET-only allowlist prevents this module from placing any orders.
  if (path !== '/markets' &&
      path !== '/portfolio/balance' &&
      !/^\/series\/[a-zA-Z0-9_-]+\/markets\/[a-zA-Z0-9_-]+\/candlesticks$/.test(path)) {
    throw new Error('Endpoint not allowlisted for paper research');
  }
  return ROOT + path;
}

export function createKalshiDemoReadOnly({
  keyId = process.env.KALSHI_DEMO_KEY_ID,
  privateKeyPem = process.env.KALSHI_DEMO_PRIVATE_KEY_PEM,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch unavailable');
  async function request(path, query = {}, authenticated = false) {
    const fullPath = demoPath(path);
    if (authenticated && path !== '/portfolio/balance') {
      throw new Error('Authenticated demo endpoint not allowlisted');
    }
    const url = new URL(fullPath, KALSHI_DEMO_ORIGIN);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
    });
    const headers = authenticated ?
      demoSignedHeaders({ keyId, privateKeyPem, path: url.pathname }) : {};
    // Do not include key material or response body in errors.
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error('Kalshi demo GET returned HTTP ' + response.status);
    return response.json();
  }
  return Object.freeze({
    async getMarkets({ limit = 25, seriesTicker, status } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        throw new Error('Invalid market page size');
      }
      if (status && !['open', 'closed', 'settled', 'unopened'].includes(status)) {
        throw new Error('Invalid market status');
      }
      return request('/markets', {
        limit,
        series_ticker: seriesTicker,
        status,
      });
    },
    async getCandlesticks({ seriesTicker, ticker, startTs, endTs, interval = 1 }) {
      if (![1, 60, 1440].includes(interval)) throw new Error('Unsupported candlestick interval');
      if (!Number.isSafeInteger(startTs) || !Number.isSafeInteger(endTs) || endTs <= startTs) {
        throw new Error('Invalid candlestick time range');
      }
      return request('/series/' + encodeURIComponent(seriesTicker) + '/markets/' +
        encodeURIComponent(ticker) + '/candlesticks', {
        start_ts: startTs,
        end_ts: endTs,
        period_interval: interval,
      });
    },
    async verifyDemoCredentials() {
      const value = await request('/portfolio/balance', {}, true);
      return { connected: true, demoBalanceDollars: Number(value.balance) / 100 };
    },
  });
}
