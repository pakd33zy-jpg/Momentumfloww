# C60/C62 original winner provenance investigation — 2026-10-12

**Scope:** Identify the executable strategy, historical data window, recorded trades and executable research command underlying the reported C60/C62 profitability, and distinguish reported results from reproducible results. Research only. Does not change or enable execution, shadow, paper or live trading.

## Bottom line

**C60 +27.13% / PF 2.19 / 33 trades and C62 +31.75% / PF 2.33 / 33 trades remain UNVERIFIED historical claims.**

They appeared in historical assistant status updates and were later transcribed into the repository's October 2026 evidence ledger. The source code, historical configuration, raw trades, dated OHLCV snapshot, output file/commit, and execution command that generated these exact claims were **not recovered** in this investigation. Do not call either strategy profitable or proven from those claims, and do not attempt to fit new parameters merely to recreate a reported headline.

## Claim provenance

| Claim | Earlier reported context | Missing essential artifact |
|---|---|---|
| C60: +27.13% net after 1% friction, PF 2.19, DD 5.90%, 33 trades | 2026-09-11 assistant research update; said 1,728 combinations, ETH/SOL/LINK all positive, 3 folds, leave-one-asset-out and 1.5% friction test (+10.63%) | exact code/params, bars and fold boundaries, trade records, output log |
| C60 alternate: +28.88%, PF 2.26, 5.90% DD, 33 trades | 2026-09-12 assistant recap | alternative trial/source fingerprint |
| C62: +31.75% after 1% friction, PF 2.33, 48.5% WR, 33 trades | 2026-09-12 assistant update; said 864 exit/hold/cooldown/trailing configurations and +15.25% at 1.5% cost | source and exact test dates, trade records, complete run log, saved configuration |
| C62 2025-10-08 through 2026-10-08 direct-source consistent replay: +0.70% portfolio-accounting return, PF 1.053, 33 accepted trades | saved `research/C62_V26_BTC_REGIME_TEST_2026-10-08.md` | need match per-trade identifiers/exit fills to other replays |
| C62 2024-10-07 through 2025-10-07 direct-source replay: -44.37%, PF 0.384, 60 accepted trades | same dated saved C62 V26 study | same issues; does closely match previously reported -44.49% PF 0.38 older fold |
| C62 2025-10-11 through 2026-10-10 source-translated WVF research: 33 accepted trades, 13 winners, normalized deployed-trade PF 0.69, -0.442% average net trade | `research/2026-10-11-wvf-c62-exact-source-audit.md` on independent WVF research branch | *not identical date window or PF calculation to prior +0.70%/1.053 portfolio replay; do not present the two as a clean one-variable discrepancy* |

The earlier assistant claims did not provide an inspectable source/output in the accessible conversation summaries. The September 11 PDF handoff `MomentumFlow_Trading_Research_Handoff.pdf` explicitly says the original C55/C60 code and raw audit need recovery rather than assuming they exist.

## GitHub history facts

1. `momentumflow/cryptoStrategyC62.js` was **added as a new file** in commit `5a95aaf5200f67729707cfd1f0bc573a3d343c06` (created 2026-10-07 22:06:05 UTC), titled **"Restore exact C62 lead-lag strategy"**. That commit shows a +95-line add of a reconstructed candidate, **not a demonstrated diff against the exact historical winning C60 file**.
2. Historical C60 search terms only matched later documentation/recovery commits, particularly `b47629fac19a3018bded9522ff3ef0229b1b353c`, titled **"Record recombination failures and C60 provenance split"**. It explicitly states the reconstructed C62 did not reproduce the earlier C60 positive fingerprint and that the original C60 audit parameter/source remains missing.
3. The cumulative research ledger itself was first added as documentation on 2026-10-08 at commit `fa301f513ccb763901faadcf4f6d7bcb95cf10a1`. It is **not** an original September executable test log.
4. The historical C62 script path, exact price series / start date and output CSV/JSON were not found in accessible files from any searched repository. The source-recovered 15m C62 code may encode parts of the verbal strategy concept, but cannot be labeled the original winning implementation without comparison.
5. Searched indexed source in `pakd33zy-jpg/Momentumfloww`, `Momentumflowww`, `Momentumflow`, `Nomentum`, and `AdaptiveConfluenceLab`; other three relevant repo searches found no C60/C62 matching file in their indexed default branch.
6. Checked selected historical branches including `v35-expectancy`, `momentumflow-research-rebuild`, `backup-before-restore`, `restore/c62-paper-shadow` for original likely code paths; did not recover an original `cryptoStrategyC60.js` or C60 output bundle. Searching indexed default branches and a handful of paths/refs is **not exhaustive forensic recovery of all object history or expired CI artifacts**.
7. Searched the persistent Library for exact C60/C62 metric/source keywords. The September 11 MomentumFlow research handoff contains a **request to recover** the original source, not the script or trade list. No matched raw trade artifact was surfaced.

## Independently relevant *negative* historical evidence retained

- `research/C62_CROSS_YEAR_FEATURE_STABILITY_2026-10-10.md`: source-based C62 trades and pre-entry-feature outcome relationships vary markedly across 3 distinct yearly windows; simple threshold filters fail chronological robustness. Existing source-based 2024/25 studies show large losses, not a stable validated family.
- `research/C62_V26_BTC_REGIME_TEST_2026-10-08.md`: two 365-day full-universe replay fingerprints (60 older; 33 newer) and explicit saved-vs-replay inconsistency.
- `research/2026-10-11-wvf-c62-exact-source-audit.md`: WVF was favorable in the recent 16 trade subset but reversed in the older 37 trade subset; this is **not** evidence to add WVF to C62.

## Specific hypotheses for why saved headline and direct replay disagree (UNTESTED)

- Original C60 may have used materially different entry logic or screening than reconstructed C62; can't identify without the original file.
- Original sample dates, base universe, fold selection, data feed, missing bars or historical data correction may have differed.
- Entry timing, stop/target intrabar precedence, gap handling, staged fill accounting, modeled friction or portfolio compounding could differ.
- A short favorable 33-trade interval may have been called "all folds"; the same trades can yield different headlines with different accounting.
- The original report may have been overstated or produced without durable tool artifacts; **possible but not proven**. Do not assert the original backtest happened, nor claim it never happened.

## Recovery gate before any promotion

A strategy result is "historically reproduced" only when all of the following exist together:
- Exact script version + commit SHA (or archived immutable script).
- Exact input historical OHLCV bars (symbol/time/start/end/feed, timestamps, checksums, coverage).
- Exact preset and starting cash/sizing/fees/slippage.
- Full entries/exits with timestamps, exit reasons, position sizes, gross and net returns.
- Re-run reproduces trade count, each trade and summary P&L/PF/DD with no hindsight edits.

Until this gate is met: **C60/C62 old profit claims are not investable evidence**. Keep the independent frozen `55/20` equity and C62 no-order crypto shadows unchanged; do not enable live trading or promote the new WVF signal. Prioritize independent strategy candidates whose source, execution mechanics, data and out-of-sample metrics are all intact.

## Canonical links
- [C62 new-source commit](https://github.com/pakd33zy-jpg/Momentumfloww/commit/5a95aaf5200f67729707cfd1f0bc573a3d343c06)
- [C60 provenance split finding](https://github.com/pakd33zy-jpg/Momentumfloww/commit/b47629fac19a3018bded9522ff3ef0229b1b353c)
- [Original cumulative ledger commit](https://github.com/pakd33zy-jpg/Momentumfloww/commit/fa301f513ccb763901faadcf4f6d7bcb95cf10a1)
- [Direct-source V26 C62 replay audit](https://github.com/pakd33zy-jpg/Momentumfloww/blob/main/research/C62_V26_BTC_REGIME_TEST_2026-10-08.md)
- [Cross-year C62 instability](https://github.com/pakd33zy-jpg/Momentumfloww/blob/main/research/C62_CROSS_YEAR_FEATURE_STABILITY_2026-10-10.md)

**Do not delete earlier claims or rewrite the original evidence. Keep this independent provenance audit adjacent as a correction.**
