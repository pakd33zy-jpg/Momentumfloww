import fetch from 'node-fetch';
import { decrypt } from './crypto.js';
import { store } from './store.js';

// ALPACA CLIENT v14
//
// Fix:
// Crypto universe is restricted to /USD pairs.
//
// Examples allowed:
// BTC/USD
// ETH/USD
// SOL/USD
// PEPE/USD
// DOGE/USD
//
// Examples blocked:
// BTC/USDT
// ETH/USDC
// ETH/BTC

export function getCredentials(mode) {
  const creds =
    store.getConfig(
      'credentials',
      {}
    );

  const entry =
    creds[mode];

  if (entry) {
    try {
      return {
        keyId:
          decrypt(
            entry.keyIdEnc
          ),

        secretKey:
          decrypt(
            entry.secretKeyEnc
          ),

        source:
          'saved',
      };
    } catch (err) {
      console.error(
        `[alpaca] Failed to decrypt ${mode} credentials:`,
        err.message
      );
    }
  }

  // Railway/environment fallback.
  //
  // Generic ALPACA_API_KEY /
  // ALPACA_SECRET_KEY are treated
  // as LIVE credentials only.

  const keyId =
    mode === 'live'
      ? (
          process.env
            .ALPACA_LIVE_API_KEY ||
          process.env
            .ALPACA_API_KEY
        )
      : process.env
          .ALPACA_PAPER_API_KEY;

  const secretKey =
    mode === 'live'
      ? (
          process.env
            .ALPACA_LIVE_SECRET_KEY ||
          process.env
            .ALPACA_SECRET_KEY
        )
      : process.env
          .ALPACA_PAPER_SECRET_KEY;

  if (
    keyId &&
    secretKey
  ) {
    return {
      keyId,
      secretKey,
      source:
        'environment',
    };
  }

  return null;
}

export function hasCredentials(
  mode
) {
  return Boolean(
    getCredentials(
      mode
    )
  );
}

function baseUrlFor(
  mode
) {
  const fallback =
    mode === 'live'
      ? 'https://api.alpaca.markets'
      : 'https://paper-api.alpaca.markets';

  return (
    mode === 'live'
      ? process.env
          .ALPACA_LIVE_BASE_URL
      : process.env
          .ALPACA_PAPER_BASE_URL
  ) || fallback;
}

async function alpacaRequest(
  mode,
  path,
  options = {}
) {
  const creds =
    getCredentials(
      mode
    );

  if (!creds) {
    throw new Error(
      `No ${mode} Alpaca credentials configured.`
    );
  }

  const res =
    await fetch(
      `${baseUrlFor(
        mode
      )}${path}`,
      {
        ...options,

        headers: {
          'APCA-API-KEY-ID':
            creds.keyId,

          'APCA-API-SECRET-KEY':
            creds.secretKey,

          'Content-Type':
            'application/json',

          ...(
            options.headers ||
            {}
          ),
        },
      }
    );

  const data =
    await res
      .json()
      .catch(
        () => ({})
      );

  if (!res.ok) {
    throw new Error(
      `Alpaca API failed (${res.status}): ${
        data.message ||
        res.statusText
      }`
    );
  }

  return data;
}

export async function placeOrder({
  mode,
  symbol,
  qty,
  notional,
  side,
  type = 'market',
  timeInForce,
}) {
  const isCrypto =
    String(
      symbol
    ).includes('/');

  const tif =
    timeInForce ||
    (
      isCrypto
        ? 'gtc'
        : 'day'
    );

  const body = {
    symbol,
    side,
    type,

    time_in_force:
      tif,
  };

  if (
    notional != null
  ) {
    body.notional =
      String(
        notional
      );
  } else if (
    qty != null
  ) {
    body.qty =
      String(
        qty
      );
  } else {
    throw new Error(
      'qty or notional is required'
    );
  }

  return alpacaRequest(
    mode,
    '/v2/orders',
    {
      method:
        'POST',

      body:
        JSON.stringify(
          body
        ),
    }
  );
}

export async function getOrder(
  mode,
  orderId
) {
  return alpacaRequest(
    mode,

    `/v2/orders/${encodeURIComponent(
      orderId
    )}`
  );
}

export async function cancelOrder(
  mode,
  orderId
) {
  const creds =
    getCredentials(
      mode
    );

  if (!creds) {
    throw new Error(
      `No ${mode} Alpaca credentials configured.`
    );
  }

  const res =
    await fetch(
      `${baseUrlFor(
        mode
      )}/v2/orders/${encodeURIComponent(
        orderId
      )}`,
      {
        method:
          'DELETE',

        headers: {
          'APCA-API-KEY-ID':
            creds.keyId,

          'APCA-API-SECRET-KEY':
            creds.secretKey,
        },
      }
    );

  if (
    !res.ok &&
    res.status !== 204
  ) {
    const data =
      await res
        .json()
        .catch(
          () => ({})
        );

    throw new Error(
      `Alpaca cancel failed: ${
        data.message ||
        res.statusText
      }`
    );
  }

  return true;
}

export async function getAccount(
  mode
) {
  return alpacaRequest(
    mode,
    '/v2/account'
  );
}

export async function getPositions(
  mode
) {
  return alpacaRequest(
    mode,
    '/v2/positions'
  );
}

export async function waitForFill(
  mode,
  orderId,
  {
    timeoutMs = 15000,
    intervalMs = 750,
  } = {}
) {
  const deadline =
    Date.now() +
    timeoutMs;

  let order =
    await getOrder(
      mode,
      orderId
    );

  while (
    Date.now() <
      deadline &&
    ![
      'filled',
      'canceled',
      'expired',
      'rejected',
    ].includes(
      order.status
    )
  ) {
    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          intervalMs
        )
    );

    order =
      await getOrder(
        mode,
        orderId
      );
  }

  return order;
}

// --------------------------------------------------
// LEGACY DISPLAY GRID
//
// NOTE:
// These fallback values are for the old Market Grid
// display only.
//
// The automated trading scanner uses Alpaca snapshots
// below and does NOT use these fallback equity prices.
// --------------------------------------------------

const STATIC_FALLBACK_PRICES = {
  BTC:
    62000,

  ETH:
    3400,

  SOL:
    145,

  SPY:
    560,

  QQQ:
    480,

  GLD:
    210,

  GBTC:
    58,
};

const COINBASE_SYMBOLS = {
  BTC:
    'BTC-USD',

  ETH:
    'ETH-USD',

  SOL:
    'SOL-USD',
};

export async function getSpotPrice(
  market
) {
  if (
    COINBASE_SYMBOLS[
      market
    ]
  ) {
    try {
      const res =
        await fetch(
          `https://api.coinbase.com/v2/prices/${
            COINBASE_SYMBOLS[
              market
            ]
          }/spot`
        );

      const data =
        await res.json();

      const price =
        Number(
          data?.data
            ?.amount
        );

      if (
        res.ok &&
        Number.isFinite(
          price
        )
      ) {
        return {
          market,
          price,
          source:
            'coinbase',
        };
      }
    } catch (err) {
      console.warn(
        `[market] Coinbase ${market} price failed: ${err.message}`
      );
    }
  }

  return {
    market,

    price:
      STATIC_FALLBACK_PRICES[
        market
      ] ??
      100,

    source:
      'fallback',
  };
}

export async function getMarketGrid(
  markets
) {
  return Promise.all(
    markets.map(
      async (
        market
      ) => {
        const spot =
          await getSpotPrice(
            market
          );

        return {
          ...spot,
          change:
            null,
        };
      }
    )
  );
}

// --------------------------------------------------
// ALPACA MARKET DATA
// --------------------------------------------------

const DATA_BASE_URL =
  process.env
    .ALPACA_DATA_BASE_URL ||
  'https://data.alpaca.markets';

async function alpacaDataRequest(
  mode,
  path
) {
  const creds =
    getCredentials(
      mode
    );

  if (!creds) {
    throw new Error(
      `No ${mode} Alpaca credentials configured.`
    );
  }

  const res =
    await fetch(
      `${DATA_BASE_URL}${path}`,
      {
        headers: {
          'APCA-API-KEY-ID':
            creds.keyId,

          'APCA-API-SECRET-KEY':
            creds.secretKey,
        },
      }
    );

  const data =
    await res
      .json()
      .catch(
        () => ({})
      );

  if (!res.ok) {
    throw new Error(
      `Alpaca market data failed (${res.status}): ${
        data.message ||
        res.statusText
      }`
    );
  }

  return data;
}

// --------------------------------------------------
// TRADABLE UNIVERSE
// --------------------------------------------------

export async function getTradableAssets(
  mode = 'live'
) {
  const [
    equities,
    crypto,
  ] =
    await Promise.all([
      alpacaRequest(
        mode,

        '/v2/assets?status=active&asset_class=us_equity'
      ),

      alpacaRequest(
        mode,

        '/v2/assets?status=active&asset_class=crypto'
      ),
    ]);

  const equityAssets =
    (
      Array.isArray(
        equities
      )
        ? equities
        : []
    ).filter(
      (asset) =>
        asset.tradable &&
        asset.status ===
          'active' &&
        asset.fractionable
    );

  /*
   * IMPORTANT:
   *
   * Only trade crypto pairs
   * whose quote currency is USD.
   *
   * This prevents the bot from
   * attempting orders such as:
   *
   * BTC/USDT
   * ETH/USDT
   * SOL/USDC
   * ETH/BTC
   *
   * when the Alpaca account has
   * USD buying power but no USDT,
   * USDC, BTC, etc.
   */

  const cryptoAssets =
    (
      Array.isArray(
        crypto
      )
        ? crypto
        : []
    ).filter(
      (asset) =>
        asset.tradable &&
        asset.status ===
          'active' &&
        String(
          asset.symbol ||
          ''
        )
          .toUpperCase()
          .endsWith(
            '/USD'
          )
    );

  return {
    equities:
      equityAssets,

    crypto:
      cryptoAssets,
  };
}

export async function getMarketClock(
  mode = 'live'
) {
  return alpacaRequest(
    mode,
    '/v2/clock'
  );
}

function chunks(
  symbols,
  n = 75
) {
  const output =
    [];

  for (
    let i = 0;
    i <
    symbols.length;
    i += n
  ) {
    output.push(
      symbols.slice(
        i,
        i + n
      )
    );
  }

  return output;
}

export async function getStockSnapshots(
  mode,
  symbols,
  {
    feed = 'iex',
  } = {}
) {
  const output =
    {};

  for (
    const batch of
    chunks(
      symbols ||
      []
    )
  ) {
    const query =
      new URLSearchParams({
        symbols:
          batch.join(
            ','
          ),

        feed,
      });

    Object.assign(
      output,

      await alpacaDataRequest(
        mode,

        `/v2/stocks/snapshots?${query}`
      )
    );
  }

  return output;
}

export async function getCryptoSnapshots(
  mode,
  symbols
) {
  const output =
    {};

  for (
    const batch of
    chunks(
      symbols ||
      []
    )
  ) {
    const query =
      new URLSearchParams({
        symbols:
          batch.join(
            ','
          ),
      });

    const data =
      await alpacaDataRequest(
        mode,

        `/v1beta3/crypto/us/snapshots?${query}`
      );

    Object.assign(
      output,

      data?.snapshots ||
      data ||
      {}
    );
  }

  return output;
}

export async function getLatestTradablePrice(
  mode,
  symbol,
  assetClass
) {
  if (
    assetClass ===
    'crypto'
  ) {
    const data =
      await getCryptoSnapshots(
        mode,
        [
          symbol,
        ]
      );

    const snapshot =
      data[symbol] ||
      data[
        symbol.replace(
          '/',
          ''
        )
      ];

    const price =
      Number(
        snapshot
          ?.latestTrade
          ?.p ??
        snapshot
          ?.minuteBar
          ?.c ??
        snapshot
          ?.dailyBar
          ?.c
      );

    if (
      !Number.isFinite(
        price
      )
    ) {
      throw new Error(
        `No Alpaca crypto price for ${symbol}.`
      );
    }

    return price;
  }

  const data =
    await getStockSnapshots(
      mode,
      [
        symbol,
      ]
    );

  const snapshot =
    data[symbol];

  const price =
    Number(
      snapshot
        ?.latestTrade
        ?.p ??
      snapshot
        ?.minuteBar
        ?.c ??
      snapshot
        ?.dailyBar
        ?.c
    );

  if (
    !Number.isFinite(
      price
    )
  ) {
    throw new Error(
      `No Alpaca stock price for ${symbol}.`
    );
  }

  return price;
}

// --------------------------------------------------
// ACCOUNT SUMMARY
// --------------------------------------------------

export async function getAccountSummary(
  mode
) {
  const account =
    await getAccount(
      mode
    );

  return {
    mode,

    connected:
      true,

    status:
      account.status ??
      null,

    accountNumber:
      account
        .account_number ??
      null,

    currency:
      account.currency ??
      'USD',

    cash:
      Number(
        account.cash ??
        0
      ),

    equity:
      Number(
        account.equity ??
        account
          .portfolio_value ??
        0
      ),

    portfolioValue:
      Number(
        account
          .portfolio_value ??
        account.equity ??
        0
      ),

    buyingPower:
      Number(
        account
          .buying_power ??
        0
      ),

    lastEquity:
      Number(
        account
          .last_equity ??
        0
      ),

    longMarketValue:
      Number(
        account
          .long_market_value ??
        0
      ),

    shortMarketValue:
      Number(
        account
          .short_market_value ??
        0
      ),

    tradingBlocked:
      Boolean(
        account
          .trading_blocked
      ),

    transfersBlocked:
      Boolean(
        account
          .transfers_blocked
      ),

    accountBlocked:
      Boolean(
        account
          .account_blocked
      ),

    patternDayTrader:
      Boolean(
        account
          .pattern_day_trader
      ),
  };
}
