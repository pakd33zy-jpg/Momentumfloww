import fetch from 'node-fetch';
import { decrypt } from './crypto.js';
import { store } from './store.js';

/**
 * Loads and decrypts stored Alpaca credentials for the given mode.
 * Returns null if none are stored.
 */
export function getCredentials(mode) {
  const creds = store.getConfig('credentials', {});
  const entry = creds[mode];
  if (!entry) return null;
  try {
    return {
      keyId: decrypt(entry.keyIdEnc),
      secretKey: decrypt(entry.secretKeyEnc),
    };
  } catch (err) {
    console.error(`[alpaca] Failed to decrypt ${mode} credentials:`, err.message);
    return null;
  }
}

export function hasCredentials(mode) {
  const creds = store.getConfig('credentials', {});
  return Boolean(creds[mode]);
}

function baseUrlFor(mode) {
  return mode === 'live' ? process.env.ALPACA_LIVE_BASE_URL : process.env.ALPACA_PAPER_BASE_URL;
}

/**
 * Places an order via Alpaca. `mode` must be 'paper' or 'live' — callers are
 * responsible for having already passed the live gate before calling this
 * with mode='live'. This function does not itself re-check the gate, by design,
 * so that it stays a thin API wrapper; route handlers own the safety checks.
 */
export async function placeOrder({ mode, symbol, qty, side, type = 'market', timeInForce = 'day' }) {
  const creds = getCredentials(mode);
  if (!creds) {
    throw new Error(`No ${mode} Alpaca credentials configured.`);
  }
  const url = `${baseUrlFor(mode)}/v2/orders`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'APCA-API-KEY-ID': creds.keyId,
      'APCA-API-SECRET-KEY': creds.secretKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ symbol, qty, side, type, time_in_force: timeInForce }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Alpaca order failed: ${data.message || res.statusText}`);
  }
  return data;
}

export async function getAccount(mode) {
  const creds = getCredentials(mode);
  if (!creds) {
    throw new Error(`No ${mode} Alpaca credentials configured.`);
  }
  const url = `${baseUrlFor(mode)}/v2/account`;
  const res = await fetch(url, {
    headers: {
      'APCA-API-KEY-ID': creds.keyId,
      'APCA-API-SECRET-KEY': creds.secretKey,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Alpaca account fetch failed: ${data.message || res.statusText}`);
  }
  return data;
}

// --- Live crypto spot prices (Coinbase), with static fallback ---

const STATIC_FALLBACK_PRICES = {
  BTC: 62000,
  ETH: 3400,
  SOL: 145,
  SPY: 560,
  QQQ: 480,
  GLD: 210,
  GBTC: 58,
};

const COINBASE_SYMBOLS = { BTC: 'BTC-USD', ETH: 'ETH-USD', SOL: 'SOL-USD' };

export async function getSpotPrice(market) {
  if (COINBASE_SYMBOLS[market]) {
    try {
      const res = await fetch(`https://api.coinbase.com/v2/prices/${COINBASE_SYMBOLS[market]}/spot`);
      const data = await res.json();
      const price = parseFloat(data?.data?.amount);
      if (!Number.isNaN(price)) return { market, price, source: 'coinbase_live' };
    } catch (err) {
      console.error(`[market] Coinbase fetch failed for ${market}:`, err.message);
    }
  }
  // Equities (SPY/QQQ/GLD/GBTC) and any failed crypto fetch fall back to static prices.
  // Per the roadmap, live equity feeds are not yet wired up.
  return { market, price: STATIC_FALLBACK_PRICES[market] ?? null, source: 'static_fallback' };
}

export async function getMarketGrid(markets) {
  const results = await Promise.all(markets.map((m) => getSpotPrice(m)));
  return results;
}
