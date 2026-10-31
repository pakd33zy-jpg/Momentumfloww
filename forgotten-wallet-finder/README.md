# Forgotten Wallet Finder (research-only MVP)

A public-chain research tool for monitoring **documented, lawful recovery leads**. It does not crack keys, derive seed phrases, bypass access controls, or move funds.

## Scope
- Candidate-driven scanning: the initial MVP checks addresses supplied with a verifiable public source and recovery-evidence note. It does not crawl every address on a blockchain (that requires large indexed datasets and still cannot establish lost ownership).
- Bitcoin: Blockstream public API for current balance and last confirmed/mempool activity.
- EVM networks: Ethereum, Polygon, Base, Arbitrum, Optimism, Avalanche and BNB Smart Chain balance checks through user-supplied public JSON-RPC endpoints. Standard JSON-RPC does not provide complete address transaction history; an indexed explorer/data provider is needed before inactivity can be asserted.
- Default inactivity threshold: 2 years.
- Results are written to `scan-results.json`.

## Run
```sh
cp candidates.example.json candidates.json
# Add real, publicly documented recovery candidates and evidence URLs.
npm test
npm run scan
```

Optional environment variables:
- `MIN_INACTIVE_YEARS=2`
- `CANDIDATES_FILE=./candidates.json`
- `ETHEREUM_RPC_URL`, `POLYGON_RPC_URL`, `BASE_RPC_URL`, `ARBITRUM_RPC_URL`, `OPTIMISM_RPC_URL`, `AVALANCHE_RPC_URL`, `BSC_RPC_URL`

No RPC key is needed for the Bitcoin MVP. Public endpoints have rate limits and should not be hammered.

## Recovery-evidence policy
A lead is included only when its source URL and evidence description are populated. A dormant address or large balance alone is not a recovery opportunity. Human review must establish the claimant's authority, ownership, applicable law, and documented recovery route before any recovery work. Do not contact presumed owners aggressively or attempt access to wallets you do not own or have written authority to recover.

## Limitations
This MVP monitors a supplied candidate list; it is not a global lost-wallet detector. EVM balances are not enough to determine last activity. Add a chain-specific indexed-history adapter (and tests) before treating an EVM address as dormant. Token balances and UTXO-level ownership analysis are not included in this first cut.
