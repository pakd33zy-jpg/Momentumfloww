import fetch from 'node-fetch';
import { decrypt } from './crypto.js';
import { store } from './store.js';

export function getCredentials(mode) {
  const creds = store.getConfig('credentials', {});
  const entry = creds[mode];
  if (!entry) return null;
  try {
    return { keyId: decrypt(entry.keyIdEnc), secretKey: decrypt(entry.secretKeyEnc) };
  } catch (err) {
    console.error(`[alpaca] Failed to decrypt ${mode} credentials:`, err.message);
    return null;
  }
}

export function hasCredentials(mode) {
  return Boolean(store.getConfig('credentials', {})[mode]);
}

function baseUrlFor(mode) {
  const fallback = mode === 'live' ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets';
  return (mode === 'live' ? process.env.ALPACA_LIVE_BASE_URL : process.env.ALPACA_PAPER_BASE_URL) || fallback;
}

async function alpacaRequest(mode, path, options = {}) {
  const creds = getCredentials(mode);
  if (!creds) throw new Error(`No ${mode} Alpaca credentials configured.`);
  const res = await fetch(`${baseUrlFor(mode)}${path}`, {
    ...options,
    headers: {
      'APCA-API-KEY-ID': creds.keyId,
      'APCA-API-SECRET-KEY': creds.secretKey,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Alpaca API failed (${res.status}): ${data.message || res.statusText}`);
  return data;
}

export async function placeOrder({ mode, symbol, qty, notional, side, type = 'market', timeInForce }) {
  const isCrypto = symbol.includes('/');
  const tif = timeInForce || (isCrypto ? 'gtc' : 'day');
  const body = { symbol, side, type, time_in_force: tif };
  if (notional != null) body.notional = String(notional);
  else if (qty != null) body.qty = String(qty);
  else throw new Error('qty or notional is required');
  return alpacaRequest(mode, '/v2/orders', { method: 'POST', body: JSON.stringify(body) });
}

export async function getOrder(mode, orderId) {
  return alpacaRequest(mode, `/v2/orders/${encodeURIComponent(orderId)}`);
}

export async function cancelOrder(mode, orderId) {
  const creds = getCredentials(mode);
  if (!creds) throw new Error(`No ${mode} Alpaca credentials configured.`);
  const res = await fetch(`${baseUrlFor(mode)}/v2/orders/${encodeURIComponent(orderId)}`, {
    method: 'DELETE',
    headers: { 'APCA-API-KEY-ID': creds.keyId, 'APCA-API-SECRET-KEY': creds.secretKey },
  });
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Alpaca cancel failed: ${data.message || res.statusText}`);
  }
  return true;
}

export async function getAccount(mode) {
  return alpacaRequest(mode, '/v2/account');
}

export async function getPositions(mode) {
  return alpacaRequest(mode, '/v2/positions');
}

export async function waitForFill(mode, orderId, { timeoutMs = 15000, intervalMs = 750 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let order = await getOrder(mode, orderId);
  while (Date.now() < deadline && !['filled', 'canceled', 'expired', 'rejected'].includes(order.status)) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    order = await getOrder(mode, orderId);
  }
  return order;
}

const STATIC_FALLBACK_PRICES = { BTC: 62000, ETH: 3400, SOL: 145, SPY: 560, QQQ: 480, GLD: 210, GBTC: 58 };
const COINBASE_SYMBOLS = { BTC: 'BTC-USD', ETH: 'ETH-USD', SOL: 'SOL-USD' };

export async function getSpotPrice(market) {
  if (COINBASE_SYMBOLS[market]) {
    try {
      const res = await fetch(`https://api.coinbase.com/v2/prices/${COINBASE_SYMBOLS[market]}/spot`);
      const data = await res.json();
      const price = Number(data?.data?.amount);
      if (res.ok && Number.isFinite(price)) return { market, price, source: 'coinbase' };
    } catch (err) {
      console.warn(`[market] Coinbase ${market} price failed: ${err.message}`);
    }
  }
  return { market, price: STATIC_FALLBACK_PRICES[market] ?? 100, source: 'fallback' };
}

export async function getMarketGrid(markets) {
  return Promise.all(markets.map(async (market) => {
    const spot = await getSpotPrice(market);
    return { ...spot, change: null };
  }));
}
