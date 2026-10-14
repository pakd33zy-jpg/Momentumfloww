# Kalshi DEMO — safe read-only integration

Research branch only. No trading or order-entry method is included. Does not modify the active Alpaca, 55/20, MACD, or C62 bot strategies.

## Key setup

The Kalshi DEMO API key is **not** the key that appeared in the earlier screenshot. Revoke that exposed key. Store the newly generated key securely.

On your Render **backend service** (not the frontend) go to Environment and set:

- KALSHI_DEMO_KEY_ID = ID from the newly issued DEMO API key
- KALSHI_DEMO_PRIVATE_KEY_PEM = complete new private key, including BEGIN/END PRIVATE KEY lines (paste in a multiline field if available; literal \n separators work too).

Do not paste keys into ChatGPT, GitHub, tickets, logs, or screenshots. Do not configure a real-money Kalshi key for these variables. The code has a hard-coded demo hostname.

The new key ID and PEM must come from the **same** key pair. Ed25519 keys work. No startup auto-trading is enabled.

## Test locally / on server

Run from momentumflow folder:

    node --test kalshiDemoReadOnly.test.mjs
    node kalshiDemoCheck.mjs

Expected message when configured: "Kalshi DEMO authentication successful (read-only)."

This checks only the API signature, virtual balance, and demo connectivity. It does NOT establish that the strategy wins money, and does not place even demo orders.

## Research

Public data is available using getMarkets and getCandlesticks. Demo data may not faithfully mirror production market conditions, and even historical quote candles do not prove a trade would have filled.

To assess a Kalshi strategy, collect completed contracts and calculate result, executable ask and quantity, bid/ask spread, fees, slippage, sample size, time-split validation, and maximum drawdown. Do not double stake after losses.

Kalshi API references:
- https://docs.kalshi.com/getting_started/api_keys
- https://docs.kalshi.com/api-reference/market/get-market-candlesticks
- https://docs.kalshi.com/getting_started/quick_start_market_data
