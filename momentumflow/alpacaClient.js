import fetch from 'node-fetch';
import { decrypt } from './crypto.js';
import { store } from './store.js';

// ALPACA CLIENT v16

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

  const keyId =
    mode === 'live'
      ? process.env
          .ALPACA_LIVE_API_KEY ||
        process.env
          .ALPACA_API_KEY
      : process.env
          .ALPACA_PAPER_API_KEY;

  const secretKey =
    mode === 'live'
      ? process.env
          .ALPACA_LIVE_SECRET_KEY ||
        process.env
          .ALPACA_SECRET_KEY
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

function selectedMode() {
  return (
    store.getConfig(
      'tradingMode',
      {
        mode:
          'paper',
      }
    ).mode ===
    'live'
  )
    ? 'live'
    : 'paper';
}

function baseUrlFor(
  mode
) {
  const fallback =
    mode === 'live'
      ? 'https://api.alpaca.markets'
      : 'https://paper-api.alpaca.markets';

  return (
    (
      mode === 'live'
        ? process.env
            .ALPACA_LIVE_BASE_URL
        : process.env
            .ALPACA_PAPER_BASE_URL
    ) ||
    fallback
  );
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
  limitPrice,
  extendedHours,
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

  if (
    limitPrice != null
  ) {
    body.limit_price =
      String(
        limitPrice
      );
  }

  if (
    extendedHours !=
    null
  ) {
    body.extended_hours =
      Boolean(
        extendedHours
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
          'active'
    );

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
  size = 75
) {
  const output =
    [];

  for (
    let i = 0;
    i <
    symbols.length;
    i += size
  ) {
    output.push(
      symbols.slice(
        i,
        i + size
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
    if (
      !batch.length
    ) {
      continue;
    }

    const query =
      new URLSearchParams({
        symbols:
          batch.join(
            ','
          ),

        feed,
      });

    const data =
      await alpacaDataRequest(
        mode,

        `/v2/stocks/snapshots?${query}`
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
    if (
      !batch.length
    ) {
      continue;
    }

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

function isoOrNull(
  value
) {
  if (!value) {
    return null;
  }

  const date =
    value instanceof Date
      ? value
      : new Date(
          value
        );

  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date.toISOString();
}

export async function getStockBars(
  mode,
  symbols,
  {
    timeframe = '1Min',
    start,
    end,
    limit = 10000,
    feed = 'iex',
    sort = 'asc',
    maxPages = 5,
  } = {}
) {
  const wanted =
    [
      ...new Set(
        (
          symbols ||
          []
        ).filter(
          Boolean
        )
      ),
    ];

  const output =
    Object.fromEntries(
      wanted.map(
        (symbol) => [
          symbol,
          [],
        ]
      )
    );

  if (
    !wanted.length
  ) {
    return output;
  }

  let pageToken =
    null;

  let page =
    0;

  do {
    const query =
      new URLSearchParams({
        symbols:
          wanted.join(
            ','
          ),

        timeframe,

        limit:
          String(
            Math.max(
              1,

              Math.min(
                10000,

                Number(
                  limit
                ) ||
                10000
              )
            )
          ),

        feed,
        sort,
      });

    const startIso =
      isoOrNull(
        start
      );

    const endIso =
      isoOrNull(
        end
      );

    if (startIso) {
      query.set(
        'start',
        startIso
      );
    }

    if (endIso) {
      query.set(
        'end',
        endIso
      );
    }

    if (pageToken) {
      query.set(
        'page_token',
        pageToken
      );
    }

    const data =
      await alpacaDataRequest(
        mode,

        `/v2/stocks/bars?${query}`
      );

    const bars =
      data?.bars ||
      {};

    for (
      const [
        symbol,
        rows,
      ] of
      Object.entries(
        bars
      )
    ) {
      if (
        !output[
          symbol
        ]
      ) {
        output[
          symbol
        ] = [];
      }

      if (
        Array.isArray(
          rows
        )
      ) {
        output[
          symbol
        ].push(
          ...rows
        );
      }
    }

    pageToken =
      data
        ?.next_page_token ||
      null;

    page +=
      1;
  } while (
    pageToken &&
    page <
      maxPages
  );

  for (
    const symbol of
    Object.keys(
      output
    )
  ) {
    output[
      symbol
    ].sort(
      (a, b) =>
        new Date(
          a?.t ||
          0
        ) -
        new Date(
          b?.t ||
          0
        )
    );
  }

  return output;
}

export async function getCryptoBars(
  mode,
  symbols,
  {
    timeframe = '1Min',
    start,
    end,
    limit = 10000,
    sort = 'asc',
    maxPages = 5,
  } = {}
) {
  const wanted =
    [
      ...new Set(
        (
          symbols ||
          []
        ).filter(
          Boolean
        )
      ),
    ];

  const output =
    Object.fromEntries(
      wanted.map(
        (symbol) => [
          symbol,
          [],
        ]
      )
    );

  if (
    !wanted.length
  ) {
    return output;
  }

  let pageToken =
    null;

  let page =
    0;

  do {
    const query =
      new URLSearchParams({
        symbols:
          wanted.join(
            ','
          ),

        timeframe,

        limit:
          String(
            Math.max(
              1,

              Math.min(
                10000,

                Number(
                  limit
                ) ||
                10000
              )
            )
          ),

        sort,
      });

    const startIso =
      isoOrNull(
        start
      );

    const endIso =
      isoOrNull(
        end
      );

    if (startIso) {
      query.set(
        'start',
        startIso
      );
    }

    if (endIso) {
      query.set(
        'end',
        endIso
      );
    }

    if (pageToken) {
      query.set(
        'page_token',
        pageToken
      );
    }

    const data =
      await alpacaDataRequest(
        mode,

        `/v1beta3/crypto/us/bars?${query}`
      );

    const bars =
      data?.bars ||
      {};

    for (
      const [
        symbol,
        rows,
      ] of
      Object.entries(
        bars
      )
    ) {
      if (
        !output[
          symbol
        ]
      ) {
        output[
          symbol
        ] = [];
      }

      if (
        Array.isArray(
          rows
        )
      ) {
        output[
          symbol
        ].push(
          ...rows
        );
      }
    }

    pageToken =
      data
        ?.next_page_token ||
      null;

    page +=
      1;
  } while (
    pageToken &&
    page <
      maxPages
  );

  for (
    const symbol of
    Object.keys(
      output
    )
  ) {
    output[
      symbol
    ].sort(
      (a, b) =>
        new Date(
          a?.t ||
          0
        ) -
        new Date(
          b?.t ||
          0
        )
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
      data[
        symbol
      ] ||
      data[
        String(
          symbol
        ).replace(
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
    data[
      symbol
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
      `No Alpaca stock price for ${symbol}.`
    );
  }

  return price;
}

const CRYPTO_GRID_SYMBOLS = {
  BTC:
    'BTC/USD',

  ETH:
    'ETH/USD',

  SOL:
    'SOL/USD',
};

export async function getSpotPrice(
  market,
  mode = selectedMode()
) {
  const isCrypto =
    Boolean(
      CRYPTO_GRID_SYMBOLS[
        market
      ]
    );

  const symbol =
    CRYPTO_GRID_SYMBOLS[
      market
    ] ||
    market;

  // Fetch the snapshot directly (rather than via getLatestTradablePrice) so we
  // also get prevDailyBar, which is what lets us compute a real daily % change
  // below instead of leaving it hardcoded to null.
  const snapshotData = isCrypto
    ? await getCryptoSnapshots(mode, [symbol])
    : await getStockSnapshots(mode, [symbol]);

  const snapshot =
    snapshotData[symbol] ||
    (isCrypto ? snapshotData[String(symbol).replace('/', '')] : undefined);

  const price = Number(
    snapshot?.latestTrade?.p ??
    snapshot?.minuteBar?.c ??
    snapshot?.dailyBar?.c
  );

  if (!Number.isFinite(price)) {
    throw new Error(`No Alpaca price for ${symbol}.`);
  }

  const prevClose = Number(snapshot?.prevDailyBar?.c);
  const change =
    Number.isFinite(prevClose) && prevClose > 0
      ? ((price - prevClose) / prevClose) * 100
      : null;

  return {
    market,
    price,
    change,

    source:
      isCrypto
        ? `alpaca_${mode}`
        : `alpaca_${mode}_iex`,
  };
}

export async function getMarketGrid(
  markets,
  mode = selectedMode()
) {
  return Promise.all(
    (
      markets ||
      []
    ).map(
      (market) =>
        getSpotPrice(
          market,
          mode
        )
    )
  );
}

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
