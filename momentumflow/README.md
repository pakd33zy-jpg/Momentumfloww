# MomentumFlow — updated live-bot build

MomentumFlow is a paper-first Node/Express + React trading assistant. This build adds an explicit **Start Live Bot / Stop Live Bot** workflow while keeping live trading behind multiple server-side gates.

## Important behavior

- Every backend restart forces Trading Mode back to **paper** and clears all 5 Live Gate confirmations.
- Live automation cannot start unless `LIVE_TRADING_ENABLED=true`, live Alpaca credentials are saved, all Live Gate items are checked, and Trading Mode is switched to live.
- The automated loop is **crypto-only (BTC, ETH, SOL)** in this first live build. It uses live Coinbase spot prices for its signal and refuses to automate if that verified price feed is unavailable.
- The bot opens **LONG positions only**. It will not attempt unsupported crypto short sales.
- Default maximum entry size is **$5 notional per trade**.
- Only one bot-managed position is allowed at a time.
- Default exits: +0.6% take-profit, -0.4% stop-loss, or 15-minute maximum hold.
- The existing 10% session-loss, 3-consecutive-loss, and trade-count safety halts remain server-enforced.
- Pressing **Stop Live Bot** stops the loop and attempts to close any bot-managed open position.
- The bot refuses to start if Alpaca already shows an open BTC/USD, ETH/USD, or SOL/USD position, or if the local trade log contains an unresolved open crypto trade.

These defaults are conservative operational guardrails, **not a claim of profitability**. The paper simulator's configured win rate is synthetic and must not be interpreted as expected live performance.

## Backend

Use the `momentumflow/` directory as the backend root. The older `momentumflow/Backend/` folder is legacy/demo code and should **not** be used for deployment.

```bash
cd momentumflow
npm install
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put the generated value into `CREDENTIAL_ENCRYPTION_KEY`.

Keep this off until you have tested setup:

```env
LIVE_TRADING_ENABLED=false
```

Start the backend:

```bash
npm start
```

Health check: `GET /api/health`.

## Frontend

```bash
cd momentumflow/frontend
npm install
npm run dev
```

For a deployed/mobile build, set `VITE_API_URL` to the HTTPS backend URL.

## Live setup sequence

1. Save Alpaca **live** credentials in Settings.
2. On the backend host, set `LIVE_TRADING_ENABLED=true` and restart.
3. Re-open Settings after restart and complete all five Live Gate items.
4. Switch Trading Mode from Paper to Live.
5. Go to Dashboard and press **Start Live Bot**.
6. Watch Sessions and bot status. Press **Stop Live Bot** to stop automation and attempt to close its current position.

## API added in this build

- `GET /api/live-bot/status`
- `POST /api/live-bot/start`
- `POST /api/live-bot/stop`

The old one-order endpoint `POST /api/sessions/live/trade` remains available behind the same Live Gate.

## Deployment note

For Render/Railway/Fly, point the service root at **`momentumflow`**, run `npm install`, and start with `npm start`. Set a persistent `DATA_DIR` if you want sessions/credentials to survive redeployments. Set `CORS_ORIGIN` to the deployed frontend origin.


## Multi-provider credential foundation (draft)

The `/connections` screen adds encrypted credential storage fields for crypto exchanges, forex/gold brokers, NinjaTrader, and Polymarket. This is a credential vault/settings foundation only: it does not yet connect those providers, validate credentials, or place orders.

### Required Render environment

- `DATABASE_URL`: the PostgreSQL connection string supplied by the Render database. The backend now reads this server-side variable directly; database URLs must not be committed to Git.
- `INTEGRATION_SETTINGS_TOKEN`: a long random access token required to open or modify the new multi-provider credential settings API. Enter the same token in the Connections screen. It is not a provider API key.

Generate the settings token locally with a password manager or a cryptographically secure random generator. Do not paste it into ChatGPT or commit it. If either variable is missing, saving is blocked rather than falling back to ephemeral storage.

Provider secrets are encrypted by the existing server-side credential encryption module and only masked status is returned to the browser. Never enter seed phrases or wallet private keys. For crypto, use trade-only API permissions and disable withdrawals. Polymarket transfer/withdrawal code is not part of this feature.

**Deployment is intentionally gated:** verify the Render database environment, configure the two variables, add full app authentication/access control for all existing trading and Alpaca credential endpoints, and run the project tests before merging or deploying. The existing app currently has other API routes that do not share this new settings-token guard.
