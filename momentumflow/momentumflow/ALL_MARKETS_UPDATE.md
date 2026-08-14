# MomentumFlow all-Alpaca-markets update
- Live bot now dynamically loads Alpaca active tradable US equities/ETFs and crypto instead of BTC/ETH/SOL only.
- Equities are filtered to fractional-tradable because the default live order cap is $5.
- Equities rotate in batches every scan; crypto scans continuously. US equities only enter while Alpaca's market clock is open.
- Uses Alpaca snapshots; stock feed defaults to IEX for Basic-plan compatibility.
- Existing Alpaca positions are excluded from new entries.
- Dashboard now shows universe size, top signals, market-open state, and actual broker connection errors.
- Dashboard data loads independently, so a failure in market/session data no longer falsely makes Alpaca show "not connected".
- Options are intentionally not auto-traded in this patch; they need separate permissions and options-specific risk controls.
