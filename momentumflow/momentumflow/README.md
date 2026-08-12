# MomentumFlow

MomentumFlow is a paper simulator plus an automated Alpaca live momentum scanner.

## Live bot scope

The automated live bot dynamically loads Alpaca active tradable **US equities/ETFs plus crypto**. It is not crypto-only. Options are not included in the automated scanner yet because options require separate contract-selection and risk controls.

The live scanner:
- refreshes Alpaca's tradable asset universe;
- scans crypto continuously;
- rotates through equity/ETF batches while the US market is open;
- enters only when the configured momentum signal qualifies;
- sizes entries using **Risk Per Trade × current Alpaca live equity**, limited by buying power;
- has **no fixed $5 entry cap**;
- keeps server-side loss/trade safety limits in force.

## Trading configuration

The editable configuration includes:
- Starting Capital (paper seed after Reset Paper Balance)
- Risk Per Trade (%)
- Max Trades Per Session
- Max Trades Per Market / Symbol
- Paper Win Rate Target (%)
- Daily Loss Halt (%)
- Consecutive Losses Before Halt

The frontend sends all of these fields to `/api/trading-config`. The dashboard polling loop does not reload/overwrite trading configuration while a user is editing it.

## Broker status

Market prices and broker connectivity are separate. The dashboard's connected indicator is based on `/api/credentials/accounts`, which verifies the paper/live Alpaca account and returns `connected: true` only when Alpaca accepts the credentials.

## Deployment

Backend root on Railway: `momentumflow`

Frontend root on Vercel: `momentumflow/frontend`

Vercel environment variable:
`VITE_API_URL=https://YOUR-RAILWAY-BACKEND/api`
