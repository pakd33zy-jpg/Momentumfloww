# MomentumFlow

Trend-aligned momentum trading assistant. Paper-first by default; live trading is
possible but sits behind multiple deliberate gates. Read the **Live trading safety**
section before you ever set `LIVE_TRADING_ENABLED=true`.

## What's here

```
backend/    Node/Express API — sessions, safety engine, Alpaca client, encrypted credentials
frontend/   React PWA — Dashboard, Sessions, Chat, Settings
```

## 1. Run the backend

```bash
cd backend
npm install
cp .env.example .env
```

Generate an encryption key and put it in `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the output into `CREDENTIAL_ENCRYPTION_KEY=` in `.env`. Leave
`LIVE_TRADING_ENABLED=false` for now.

```bash
npm start
```

Backend runs on `http://localhost:4000`. Check `http://localhost:4000/api/health`.

## 2. Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Opens on `http://localhost:5173` and proxies `/api` calls to the backend.

## 3. Try it paper-first

1. Open the app, go to **Dashboard**, tap **Run paper session**. This never touches
   Alpaca or risks capital — it's a self-contained simulation.
2. Check **Sessions** to see the trade log and equity curve.
3. Try the **Chat** tab: "run the bot", "go live", "stop".

## 4. Connecting Alpaca (paper trading via the real API)

1. Create a free [Alpaca](https://alpaca.markets) account and generate **paper**
   API keys from their dashboard.
2. In the app, go to **Settings → Broker connection → Paper keys → Add keys**.
   Keys are encrypted (AES-256-GCM) before they touch disk — see
   `backend/src/crypto.js`.

At this point paper trading is real (calls Alpaca's paper endpoint), but the
`/sessions/paper/run` route in this build still uses the built-in simulator, not
live Alpaca paper order placement — see "What's simulated vs. real" below.

## 5. Live trading — read this before you touch it

Live trading requires **all** of the following simultaneously; missing any one of
them blocks it entirely, and this is enforced server-side, not just in the UI:

1. **All 5 Live Gate checklist items** confirmed in Settings.
2. **`LIVE_TRADING_ENABLED=true`** set in the backend's `.env` — a deliberate
   operator-level switch that a UI click can't flip. Restarting the server does
   **not** re-enable this even if it was true before; it does reset the 5
   checklist consents to unchecked (see `server.js`, `resetToPaperModeOnBoot`),
   so you always have to re-confirm the checklist after any restart.
3. **Real Alpaca live API keys** saved under Settings → Broker connection → Live keys.

Even fully unlocked, live trades are placed **one at a time** via
`POST /api/sessions/live/trade` — there is intentionally no autonomous loop that
fires off a live session's worth of trades unattended. Every live order is a
distinct API call your frontend (or you, via curl/Postman) makes.

Server-enforced safety rules apply to live sessions the same as paper:
- 10% daily loss → auto-halt
- 3 consecutive losses → auto-halt
- 12 trades per market, 24 per session (soft cap you'll want to lower for real capital)

**This is a reference implementation, not a production trading system.** Before
risking real money, you should at minimum:
- Replace the simplistic momentum signal with a strategy you've actually backtested
- Add position-closing logic and P&L reconciliation against Alpaca's fills, not
  just the locally estimated `pnl` field
- Add logging/alerting outside the process itself (a crash mid-session with an
  open live position won't page you)
- Consider lowering the trade caps significantly for your first real sessions

## What's simulated vs. real right now

| Feature | Status |
|---|---|
| Paper session simulator (Dashboard "Run paper session") | Fully simulated locally, no Alpaca calls |
| Crypto prices (BTC/ETH/SOL) | Live, from Coinbase's public spot price API |
| Equity prices (SPY/QQQ/GLD/GBTC) | Static fallback values — not live |
| Live order placement (`/api/sessions/live/trade`) | Real Alpaca API call, behind the full gate described above |
| Credential storage | Real AES-256-GCM encryption at rest |

## Deploying

- **Backend**: any Node host that supports environment variables and a persistent
  disk for `backend/data/*.json` (Railway, Render, Fly.io). Set `CORS_ORIGIN` to
  your deployed frontend's URL.
- **Frontend**: any static host (Vercel, Netlify, Cloudflare Pages). Set the build
  command to `npm run build`, output directory `dist`, and point `/api` at your
  deployed backend (edit the proxy or add a full URL in `src/lib/api.js`).

I can't host or deploy this for you directly — no persistent hosting on my end —
but this is ready to push to a repo and deploy through any of the above.
