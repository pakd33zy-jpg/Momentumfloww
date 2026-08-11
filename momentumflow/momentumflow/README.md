# MomentumFlow — Alpaca multi-market live bot

MomentumFlow is a Node/Express + React trading assistant with a resettable paper simulator
and an automated Alpaca live scanner.

## Current live-bot behavior

- The automated live bot dynamically loads Alpaca **active tradable equities/ETFs + crypto**.
- Options are intentionally excluded until options-specific permissions, contract selection,
  exits, and risk controls are implemented.
- Equities are entered only when Alpaca reports the US market open; crypto can scan continuously.
- The scanner rotates through the equity universe and evaluates crypto each scan.
- Entry sizing is **not fixed at $5**. It uses the saved **Risk Per Trade** fraction of current
  Alpaca live equity, capped by available buying power.
- Live Total Assets/equity comes from Alpaca and is treated as broker-authoritative.
- Only one bot-managed position is allowed at a time.
- Live automation still requires `LIVE_TRADING_ENABLED=true`, verified live Alpaca credentials,
  all five Live Gate confirmations, and Trading Mode set to Live.
- Stop-loss, take-profit, maximum hold, daily-loss halt, consecutive-loss halt and trade caps
  remain safety controls. User-adjustable trade/loss limits are stored by the backend.

The paper simulator is separate from live execution. Its synthetic win-rate setting is a
simulation parameter and is not an estimate or guarantee of live performance.

## Adjustable settings

The Dashboard drop-down and Settings page use the same backend configuration:

- Starting Capital — paper seed after Reset Paper Balance
- Risk Per Trade — live notional as a fraction of current Alpaca equity
- Max Trades Per Session
- Max Trades Per Market / Symbol
- Paper Win Rate Target
- Daily Loss Halt
- Consecutive Losses Before Halt

Changing one field no longer causes another field to reload/reset; configuration is refreshed
on page entry and after an explicit save rather than on every 5-second dashboard poll.

## Backend deployment

Deploy the **`momentumflow/`** directory as the backend root. `momentumflow/Backend/` is
legacy/demo code and is not the production backend.

```bash
cd momentumflow
npm install
npm start
```

Required deployment settings include `CREDENTIAL_ENCRYPTION_KEY`, `CORS_ORIGIN`, and,
only when deliberately enabling live automation, `LIVE_TRADING_ENABLED=true`.

Health check: `GET /api/health`

## Frontend deployment

Deploy `momentumflow/frontend` with Vite:

```bash
npm install
npm run build
```

Output directory: `dist`

Set `VITE_API_URL` to the deployed backend URL ending in `/api`.

## Live-bot API

- `GET /api/live-bot/status`
- `POST /api/live-bot/start`
- `POST /api/live-bot/stop`

The manual one-order endpoint `POST /api/sessions/live/trade` remains available separately.
