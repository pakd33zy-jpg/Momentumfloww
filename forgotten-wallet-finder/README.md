# Forgotten Wallet Finder (research-only MVP)

A public-chain research tool for monitoring **documented, lawful recovery leads**. It does not crack keys, derive seed phrases, bypass access controls, or move funds.

## What it currently does
- Scans a supplied list of candidate addresses; it does **not** enumerate every address on either blockchain.
- Bitcoin: Blockstream public API for current BTC balance and newest confirmed/unconfirmed transaction.
- Ethereum: Blockscout indexed account and transaction APIs for ETH balance and newest transaction.
- Enriches BTC/ETH balances with optional USD spot prices from CoinGecko; scans continue if price lookup is unavailable.
- Filters by optional minimum estimated USD value and ranks results from highest to lowest estimated value.
- Default inactivity threshold: 2 years.
- Results are written to `scan-results.json`.

## Run
```sh
cp candidates.example.json candidates.json
# Add addresses with a verifiable public source and recovery-evidence note.
npm test
npm run scan
```

Environment variables:
- `MIN_INACTIVE_YEARS=2`
- `MIN_VALUE_USD=0` (set a higher floor to focus on large balances)
- `CANDIDATES_FILE=./candidates.json`

No API keys are required for the Bitcoin or Ethereum public endpoints. Public services impose rate limits.

## Discovery limitation
A truly broad scan of all dormant wallets requires a full indexed blockchain dataset or a commercial/public analytics index. Public RPC endpoints cannot list all addresses. This MVP therefore supports candidate discovery/import as a separate stage and verifies the supplied candidates; it must not be described as a global scanner.

## Recovery-evidence policy
A lead is included only when its source URL and evidence description are populated. A dormant address or large balance alone is not a recovery opportunity. Human review must establish the claimant's authority, ownership, applicable law, and documented recovery route before any recovery work. Do not attempt access to wallets you do not own or have written authority to recover.
