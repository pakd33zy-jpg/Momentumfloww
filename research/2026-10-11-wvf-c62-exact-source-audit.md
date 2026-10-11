# C62 × Williams VIX Fix — frozen-entry observational audit (2026-10-11)

**Verdict: REJECT WVF as a promotion-ready rank/filter for C62.** Interesting association in the recent interval *reversed direction* in the preceding year. Original C62 and 55/20 shadow strategies were not changed or deployed. This record belongs to the independent research branch, not the trading runtime.

## Question / design

User-supplied videos `3198.mp4` and `3199.mp4` show Williams VIX Fix (WVF) and Stochastic-based market bottoms. Earlier 4h proxy experiments did not show a profitable five-coin combination. Hypothesis here: **without changing any existing C62 entry, exit or sizing rules**, does a recent WVF spike predict better realized C62 signal quality, making it useful as a ranking/context variable?

**Crucial structural result:** the frozen C62 shadow targets only ETH/USD, SOL/USD and LINK/USD, each capped at 20% of equity, with 80% portfolio exposure ceiling. Three fully sized positions total at most 60% equity. Absent additional competing strategies or tighter future cash limits, ranking candidates cannot affect entry decisions: all qualifying target positions can fit. Four simultaneous two-coin signal times were observed in the recent interval and six timestamps (one three-coin time) in the older interval; none needs rank-based exclusion under this design. A rank-only patch therefore has **zero mechanical opportunity to improve historical trade results** in the unchanged C62 shadow.

Rather than introduce an artificial one-slot cap to make ranking *appear* useful, this audit holds C62 fixed and labels each historically generated trade with independently computed *past-only* WVF context. This tests association, **not ranking P&L**, and does **not** advocate gating entries based on the result.

## Source/method fingerprints

- Read-only source reference: `momentumflow/cryptoStrategyC62.js` (C62 live shadow candidate logic), `momentumflow/c62RegimeResearch.js` (closed-bar historical simulation), `momentumflow/c62ShadowRouter.js` (portfolio cap, state and position implementation). Read against 2026-10-11 main branch.
- 15-minute Alpaca US crypto OHLCV for BTC/USD (leader), ETH/USD, SOL/USD, LINK/USD (targets), downloaded in monthly windows, sorted and deduplicated by timestamp. Warmups begin 2024-09-01 and 2025-09-01, respectively.
- C62 signal: BTC prior 8 completed 15m bars return >= 0.60%; BTC ATR14 simple true-range mean / close >= 0.40%; BTC 64-bar high/low structure rising vs preceding 64; target 64-bar structure not falling; target return on same 8 bars between 0 and 50% of BTC return; signal candle bullish and its close > previous candle high. BTC and target signal bar timestamps must match.
- Historical entry: **next contiguous 15m open**, not the snapshot price used in forward shadow. Stop = entry - 2.5 × signal ATR14 as a fraction of signal close. Profit target = 3.25R; half-size initial leg, one add at +1R; trailing activates after +2.5R with trail distance 1.5R; 96-bar maximum hold, 15m cooldown; stop priority if both stop/target touched in one bar, unfavorable entry/exit gaps modeled. 1.00% combined estimated round-trip trading cost applied to each leg. Same execution convention as `c62RegimeResearch.js` rather than exact minute-by-minute live/paper fills.
- **WVF** at signal candle: (highest close during 22 candles - current low)/highest close × 100. Green if WVF >= its trailing 20-bar mean + 2 population standard deviations **OR** WVF >= 0.85 × maximum WVF over trailing 50 bars. Label recent-WVF=true if *any* green candle was present at signal or previous 12 completed candles (13 candles inclusive). No future bars feed indicators. **Stochastic not used** in this exact-C62 observational test.
- Position concurrency handled **per asset** (skip signals until prior position exits + one cooldown bar) as in existing research. All summary numbers below are distributions of **net percentage returns on deployed trade capital**; sums of trade returns, PF and win rates **are not shared-capital portfolio returns or verified live fills**. Data may have sparse/missing crypto bars; per-bar max-hold is not always exactly 24 wall-clock hours. Results must be replicated under a version-controlled harness before promotion.

## Results (chronological split, no tuning between periods)

| Window | Cohort | Trades | Winners | Win % | PF | Mean net trade % |
|---|---|---:|---:|---:|---:|---:|
| 2024-10-11 to 2025-10-10 UTC | **All C62** | 60 | 14 | 23.3 | 0.25 | -1.776 |
| Older | WVF present | 37 | 7 | 18.9 | 0.22 | **-1.863** |
| Older | WVF absent | 23 | 7 | 30.4 | 0.29 | **-1.636** |
| 2025-10-11 to 2026-10-10 UTC | **All C62** | 33 | 13 | 39.4 | 0.69 | -0.442 |
| Newer | WVF present | 16 | 9 | 56.3 | 1.69 | **+0.678** |
| Newer | WVF absent | 17 | 4 | 23.5 | 0.19 | **-1.497** |

**No C62 variant passed both periods.** The recent WVF subgroup appears favorable, but the preceding year's WVF subgroup is negative and worse than the no-WVF group. Do not select recent-only data to justify a filter.

### Per-asset recent-period sample (2025-10-11 to 2026-10-10)

| Target | All | With WVF | Without WVF |
|---|---|---|---|
| ETH/USD | 8 trades; PF 1.09; mean +0.059% | 4 trades; PF 1.82; mean +0.533% | 4 trades; PF 0.43; mean -0.415% |
| SOL/USD | 13; PF 0.74; mean -0.403% | 8; PF 1.31; mean +0.375% | 5; PF 0.20; mean -1.647% |
| LINK/USD | 12; PF 0.55; mean -0.819% | 4; PF 2.69; mean +1.430% | 8; PF 0.15; mean -1.944% |

In the **older period**, the WVF subgroup was negative for **all three target coins**: ETH (15 trades, PF 0.24, -1.304% average); SOL (17, PF 0.31, -1.703%); LINK (5, PF 0.00, -4.083%).

### Raw data counts after monthly merge/deduplication

| Period | BTC | ETH | SOL | LINK |
|---|---:|---:|---:|---:|
| Older with warmup | 38,765 | 38,876 | 38,872 | 38,868 |
| Recent with warmup | 38,924 | 38,803 | 38,844 | 38,860 |

All 28 monthly Alpaca retrieval requests returned without reported request errors. Completed bar timestamp gaps differ across symbols, so an independent fill-quality and gap audit is still required.

## Provenance caveat versus preserved historical C60/C62 ledger

The source-specified C62 research contract run here produced 60 trades in the older year and 33 in the newer year, with both baseline PF values below 1. The pre-existing `research/STRATEGY_EVIDENCE_LEDGER.md` separately records a C62 **33-trade**, PF **2.33**, approximately **+31.75%** historical fingerprint. These fingerprints **do not reconcile** without verifying identical calendar ranges, datasets, trade selection, execution costs, portfolio sizing and code versions. Do not overwrite the earlier entry, average the numbers, or assume this run disproves its original historical calculation. Treat the mismatch as an unresolved reproducibility/provenance investigation.

## Learning retained

1. **Recent-only improvement was a regime-dependent false positive.** Always validate candidate features on other chronological windows.
2. Under the current 3 × 20% caps, WVF ranking **cannot improve cash-contended selection because there is no cash contention to resolve**.
3. WVF is a potentially useful **observational market-stress feature**, not evidence for gating or selecting C62 entries.
4. C62 may underperform badly in a regime with clustered breakouts and no follow-through; this deserves **baseline** provenance/condition analysis, not indiscriminate filter stacking.
5. C62 33-trade saved PF 2.33 history and the differing two-period live-source simulation must be reconciled by a common frozen harness before any strategy-performance promotion.
6. Keep WVF, candidate alignment dates, data retrieval footprints, exact cost assumptions and losing configurations for future evidence reuse. Never alter the active shadow based on one favorable slice.

**Decision**: no rule change; no WVF ranking deployed; no live orders; no modification to the frozen C62 or 55/20 execution paths.
