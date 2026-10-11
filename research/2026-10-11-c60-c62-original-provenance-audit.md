# C60/C62 source and profit-fingerprint provenance audit — 2026-10-11

**Status: root provenance mismatch identified; original winning artifact not recovered.** Independent research record only. No changes to the frozen C62 crypto shadow, 55/20 equity shadow, or the broker/runtime code.

## What is established from Git history

1. The *currently deployed-code candidate* `momentumflow/cryptoStrategyC62.js` was **created as a completely new 95-line file**, not modified from a surviving original C60 script, by commit `5a95aaf5200f67729707cfd1f0bc573a3d343c06` on **2026-10-07 22:06:05 UTC**. Commit title: **“Restore exact C62 lead-lag strategy.”** The title alone does not substantiate a byte-for-byte match to the 2026-09 original C60/C62 backtest.
2. Subsequent independent commits created the C62 paper-shadow router `ff2966ec01b2b82cbf005bc8e76803cb1df519dd` and attached it to startup `6af5861ec786b2479a54b3dd069b817b2a9b8cdd`.
3. The cumulative `research/STRATEGY_EVIDENCE_LEDGER.md` was itself **created** by commit `fa301f513ccb763901faadcf4f6d7bcb95cf10a1` on **2026-10-08 04:52:56 UTC**, retroactively summarizing earlier C55/C60/C62 experiments. It is an important historical account, **not original time-stamped trades or executable C60 source**.
4. Connected GitHub code search for C60, the exact numbers, and the linked `AdaptiveConfluenceLab` repository did not recover the old C60 implementation or its original fills. A targeted scan of historical Momentumfloww branches `v35-expectancy`, `momentumflow-research-rebuild`, `backup-before-restore`, and `restore/c62-paper-shadow` found the same restored C62 blob where present, and no `cryptoStrategyC60.js` at the checked paths. This is an **examined-path limit**, not proof that a copy exists nowhere.
5. The Library file `MomentumFlow_Trading_Research_Handoff.pdf`, created **2026-09-11**, explicitly says exact C55/C60 metrics and source/artifacts still need to be recovered from saved files/repositories. Thus missing source is not newly caused by today's WVF test.

## Distinct historical fingerprints — do not merge

| Version/fingerprint | Claim or replay | Attribution |
|---|---|---|
| Original C60 strongest noted audit | +27.13% after 1% friction; PF 2.19; DD 5.90%; 33 trades; all three folds/coins positive; +10.63% at 1.5% friction | Later saved research synopsis; original source/trade list missing |
| Alternative C60 saved recap | +28.88%, PF 2.26, DD 5.90%, 33 trades | Different original recap, discrepancy unresolved |
| C62 historical claimed improvement | +31.75% after 1% friction; PF 2.33; 48.5% wins, 33 trades | Retroactive evidence ledger, source audit trail absent |
| Reconstructed C62 recent 365d, early replay | -0.04%, PF 1.03, 33 trades | 2026-10-07 reconstruction research note |
| Reconstructed C62 recent 365d, consistent direct-Alpaca replay | +0.70%, PF 1.053, 33 trades | `research/C62_V26_BTC_REGIME_TEST_2026-10-08.md` |
| Another saved recent C62 fingerprint | +13.87%, PF 1.62, 33 trades | **Explicitly NOT reproduced** by consistent direct replay |
| Reconstructed C62 prior 365d direct replay | -44.37%, PF 0.384, 60 trades | `research/C62_V26_BTC_REGIME_TEST_2026-10-08.md` |
| Oct-2025–Oct-2026 independent WVF observational replay | 33 trades; 13 winners; PF 0.69; mean trade net -0.442% on deployed trade notional | `research/2026-10-11-wvf-c62-exact-source-audit.md`; different window/accounting, **not** a portfolio return |
| Oct-2024–Oct-2025 independent WVF observational replay | 60 trades; 14 winners; PF 0.25; mean net trade -1.776% on deployed trade notional | Same file and caveat |

**Important:** coincidence of 33 trades is not enough to establish identical entry timestamps, order sizes, exit timestamps, per-leg fee treatment, trade filtering, interval, or shared-capital equity convention. Likewise summing normalized per-trade percentages is NOT a realized account return. Direct comparison of raw headline returns above would be invalid.

## Exact restored C62 fingerprint and plausible mismatches

- The **newly created 2026-10-07 C62 source** uses **BTC 2h return >= 0.60%**, BTC 15m ATR14 / BTC close >= 0.40%, 64-bar structure checks, lagging target 2h return >=0 and <=50% of BTC return, plus target bullish close and prior-high breakout.
- The earlier **C55** historical description says BTC up **about 1% in 2 hours**, a bullish/high-volatility BTC regime, and lagging ETH/SOL/LINK; **the precise original winning C60 thresholds, data folds, universe, exits, and sizing are unverified**.
- The saved restored C62 exit uses 2.5 ATR initial stop, +3.25R target, half starter and remaining half only after +1R, trail trigger +2.5R, distance 1.5R, 24h maximum hold, ~1% round-trip cost.
- C59->C60 original progression explicitly **removed a losing mean-reversion branch**. That deletion is a preserved lesson, not proof this restored C62 entry is byte-identical to the original C60 momentum subset.
- The restored backtester books **next contiguous 15m open**; live C62 shadow currently builds signal using the latest close/snapshot and tracks minute-bar exits. Original historical simulator timestamp alignment, signal/cancel accounting, asset bar sparsity, fill assumptions, fee deductions, equity sizing, and stopping rule are unknown.

## Conclusion: what explains the discrepancy, and what does NOT

**Confirmed provenance root issue:** a **reconstructed October 2026 file was treated as if it necessarily reproduced the earlier September winning logic**. The Git commit proves the source was created as a new file; absent the original code and trade blotter, the identity claim is **not verified**.

**Not established:** exactly which entry threshold, execution assumption, data fold, fee, position sizing or bookkeeping difference generated +31.75%; neither a confirmed software bug nor falsification of an original profitable test can be claimed.

**Next reproducibility gate (no parameter mining):**
1. Recover **original C60 and C62 dated source or raw trade CSV/JSON** and original period boundaries.
2. Fingerprint each of the 33 original entries/exits **by symbol, signal timestamp, actual fill timestamps/price, side, fees, size and reason**.
3. Align exact 15m OHLCV source, missing-bar policy and candle completion convention.
4. Compare original and reconstructed signal sets first, then **fix trade selection**; only after identical trades test exit and portfolio P&L accounting on one shared harness.
5. If original artifacts remain unavailable, explicitly **downgrade +27.13% / +31.75% to historical unverified claims** and do not promote them.
6. Do not repeat failed hard gates against reconstructed C62 as though recovering historical returns.

## Known evidence links
- New reconstructed source: https://github.com/pakd33zy-jpg/Momentumfloww/commit/5a95aaf5200f67729707cfd1f0bc573a3d343c06
- Retroactive ledger creation: https://github.com/pakd33zy-jpg/Momentumfloww/commit/fa301f513ccb763901faadcf4f6d7bcb95cf10a1
- Stored direct replay conflict: `research/C62_V26_BTC_REGIME_TEST_2026-10-08.md`
- Two-period C62×WVF outcome: `research/2026-10-11-wvf-c62-exact-source-audit.md`
- Library handoff source: `MomentumFlow_Trading_Research_Handoff.pdf` (2026-09-11)

**Decision:** preserve every past claim; mark prior profits not independently reproducible from surviving sources; do not change active strategies.
