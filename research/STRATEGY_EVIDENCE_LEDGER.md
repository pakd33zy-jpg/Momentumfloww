# MomentumFlow Strategy Evidence Ledger

_Last updated: 2026-10-07_

## Purpose

Never discard a strategy because the whole strategy failed. Preserve every tested component, execution assumption, result, weakness, and failure mode so future research can recombine evidence instead of restarting.

This ledger is research-only. It does not authorize live trading and does not change the active 55/20 equity shadow or C62 crypto shadow.

## Permanent research rules

1. A failed strategy is data, not trash.
2. Store the verdict on each **component** separately from the verdict on the whole strategy.
3. Preserve execution corrections: completed candles only, no lookahead, next eligible bar/open execution, entry-bar stop handling, adverse-gap handling, realistic modeled costs, shared-capital accounting, and deterministic same-time allocation.
4. A component that failed in one context is not automatically banned in every context. Record **where and why** it failed.
5. Do not mechanically stack every “good” filter. Every added gate must prove that it improves expectancy/robustness enough to justify lost trade frequency.
6. Prefer one-major-change-at-a-time comparisons against a frozen baseline.
7. Historical success earns unseen validation; unseen success earns forward paper/shadow testing. Nothing jumps directly to live money.
8. Keep trade count, signal capture, concentration, and cost sensitivity alongside return/PF/drawdown.
9. If results conflict across saved artifacts, preserve both fingerprints and resolve them from source rather than guessing.

---

## Current frozen baselines

### Equity: DAILY 55/20 Liquid100

**Core**
- Long only.
- Signal on completed daily close above prior 55-day high.
- Enter next open.
- Exit signal on completed daily close below prior 20-day low.
- Exit next open.
- Research shared-capital candidate: 2.5% of current portfolio equity per accepted entry.
- No leverage.
- Default modeled round-trip cost: 0.04%.

**Five-year Liquid100 evidence**
- Raw signals: 1,010 trades (~202/year).
- Raw PF: 1.683.
- 58/100 symbols positive.
- 2.5% shared-capital: +64.678%.
- Recent 365d: +17.793%.
- Max daily mark-to-market DD: 13.939%.
- Accepted entries: 710; skipped for cash: 300; signal capture: 70.3%.
- 2022 was negative (-8.981%); 2023-2026 positive.
- Cost stress remained positive through 0.30% modeled round-trip cost.
- Sizing neighborhood 1.75%-3.5% remained positive; 2.5% is not a single-point optimum.

**Independent validation50**
- 502 raw trades (~100/year).
- Raw PF: 1.618.
- 29/50 symbols positive.
- 2.5% shared-capital: +23.068%.
- Recent 365d: +8.375%.
- DD: 8.425%.
- 2022 negative; 2023-2026 positive.

**Reusable evidence**
- Slow breakout/trend persistence works across a broad equity/ETF universe better than many heavily filtered intraday stacks.
- The 20-day low exit is a viable long-horizon trend exit.
- Shared-capital/cash contention materially changes headline results; raw compounded symbol stats must not be treated as portfolio returns.
- Robustness across nearby sizing and higher costs is a positive feature.

**Open questions**
- Can selection/ranking improve capital use without turning the system into an over-filtered low-frequency strategy?
- Can portfolio correlation controls reduce DD while preserving signal capture?
- Can prior momentum/regime evidence improve ranking rather than gate entries?

---

### Crypto: C60 core recovered through exact C62 source

**Universe / role**
- BTC is the leader, not a target.
- Targets: ETH, SOL, LINK.
- Long only.
- Closed 15-minute candles only.

**Exact recovered lead-lag entry logic**
- 2-hour lookback = 8 completed 15m bars.
- BTC 2h move >= +0.60%.
- BTC ATR14 / BTC close >= 0.40%.
- BTC 64-bar structure must be up.
- Target asset 64-bar structure must not be down.
- Target asset 2h move must be >= 0 and <= 50% of BTC's 2h move (lagging, partially reacted).
- Current target candle bullish.
- Target close above prior completed candle high.

**Exact C62 exit/risk layer**
- Initial stop distance: 2.5 x target ATR14.
- Target: 3.25R.
- Modeled round-trip cost: 1.0%.
- Maximum hold: 96 x 15m = 24h.
- Trailing trigger: +2.5R.
- Trailing distance: 1.5R.
- Start at 50% planned notional.
- Add remaining 50% at +1R if exposure allows.
- Re-entry cooldown: 15m in recovered shadow implementation.

**Historical C60 audit fingerprints**
- One recovered audit fingerprint: ~+27.13%, PF ~2.19, max DD ~5.90%, 33 trades.
- A later saved recap referenced ~+28.88%, PF ~2.26, max DD ~5.90%, 33 trades.
- Treat the metric difference as unresolved provenance, not as permission to average or choose the prettier result.
- The signal family itself is now source-recovered through C62; the exact original C60 result artifact still needs source matching.

**Reusable evidence**
- Cross-asset lead/lag can be a useful predictive structure: leader impulse first, target partially reacts, then target confirms.
- Relative reaction is more informative than “coin is green” by itself.
- Market structure + volatility regime + local breakout can be compatible when used to describe a specific causal setup rather than as generic filter stacking.
- Staged entry and ATR-scaled exits are separable components and should be tested independently from the lead-lag entry.

**Current status**
- C62 runs as no-order paper-shadow.
- Legacy MACD crypto engine is blocked from new entries; old positions are managed to completion.
- Do not modify C62 shadow rules from forward outcomes.

---

## Historical component evidence

### V26 ETF momentum rotation — strong historical result, concentration weakness

**Rules**
- Universe: SPY, QQQ, IWM, DIA, XLK, XLF, XLE, GLD, TLT.
- 63-session momentum.
- Eligible when momentum > 0 and close > SMA150.
- Rebalance every 5 completed sessions.
- Rank eligible ETFs.
- 70% to #1, 30% to #2.
- Next regular-session open execution.

**Evidence**
- Full period: +60.08%.
- CAGR: 20.04%.
- PF: 1.46.
- Win rate: 59.47%.
- 190 position trades.
- Max DD: -13.33%.
- Positive under 2x, 4x, and 8x tested costs.
- 24/24 nearby weighted-rotation configurations positive in train, validation-1, validation-2.

**Failure / weakness**
- GLD was a major profit contributor (~$29.3k of ~$60k total PnL on $100k start).
- Removing GLD reduced return to ~+25.8% and worsened DD to ~-22.8%.
- Therefore the headline edge was materially regime/concentration dependent.

**Reusable pieces**
- 63-session relative momentum ranking.
- SMA150 eligibility as a broad trend/regime descriptor.
- Fixed rebalance cadence.
- Ranking/selection rather than binary signal gating.
- Concentration tests must be mandatory for any future multi-asset strategy.

---

### V26 tactical daily pullback — useful low-DD secondary setup

**Rules**
- Close > SMA150.
- RSI(2) <= 10.
- Enter next open.
- 2 ATR stop.
- 2.5R target.
- Maximum 5 trading days.

**Evidence**
- +14.17%.
- 60.14% win rate.
- PF 1.75.
- Max DD -3.61%.
- 148 trades.
- Positive under approximately 2x tested costs.
- Signal neighborhood reasonably stable around RSI10 and SMA100-200.

**Reusable pieces**
- Oversold pullback within long-term uptrend.
- Short maximum hold.
- ATR risk + asymmetric target.
- Candidate as an independent sleeve, not necessarily a filter on 55/20.

---

### V6R_ROBUST — initial promise, unseen failure

**Evidence**
- Prior sample: 59 trades, ~61% win rate, +2.56%, max DD about -1.27%.
- Still positive under doubled costs on that sample.
- Later dual-unseen validation: negative returns and PF < 1.

**Failure lesson**
- A clean-looking development sample can be false confidence.
- Unseen validation is mandatory.
- Do not use its original headline stats as proof of edge.

**Reusable pieces**
- Any individual risk/entry component must be re-evaluated in isolation before reuse.
- “Low drawdown” by itself is not enough if expectancy does not generalize.

---

### Corrected crypto persistent breakout core — real edge signal but concentrated

**Core**
- 55-day breakout.
- Rising EMA200.
- Next-open entry.
- 3 ATR initial stop.
- Prior-20-day-low trail.

**Corrected shared-capital evidence**
- 66 closed trades.
- ~+12.95%.
- PF 1.83.
- ~7.11% daily-close DD.
- 1% modeled round-trip cost.

**Failure / weakness**
- Removing SOL and XRP together changed result to ~-1.78%, PF 0.88.
- Edge was too concentrated to call robust.

**Reusable pieces**
- Trend persistence.
- Long-horizon breakout.
- ATR initial risk.
- Prior-N-day-low trailing exit.
- Mandatory leave-one/two-asset-out concentration tests.

---

### Crypto liquidity ranking experiment — tradability useful, predictive edge not established

**Evidence**
- Causal top-half trailing liquidity rank improved development headline to 50 trades and PF 2.20 at 1% cost.
- Removing two best trades made net result negative.
- 2025 PF ~0.52.

**Conclusion**
- Keep liquidity as a tradability/capacity control.
- Do not assume liquidity rank itself is predictive alpha.
- Future tests may use liquidity for execution quality without counting it as an edge signal.

---

### Equity EMA200 + structure + MACD arm + later EMA20 confirmation — sequencing good, stack too restrictive

**Corrected logic**
- EMA200 trend.
- Confirmed structure.
- MACD crossover arms setup.
- EMA20 confirmation must occur on a strictly later completed candle.
- Structured pullback stop.
- Exact 2R target.

**Evidence**
- Only 7 stored-window trades after same-candle defect correction.
- Twelve-stock stored-window portfolio ~+0.43%, PF 1.52 at 0.05% cost.
- Twelve new symbols in 2025 produced only 4 trades for the full year.

**Failure / weakness**
- Operationally/statistically inadequate frequency.
- Gate stacking suppressed opportunities.

**Reusable pieces**
- Later-candle confirmation sequencing is a **data-integrity/execution lesson**.
- EMA200 can describe trend context.
- MACD may be useful as an arm/trigger component, but should not automatically be stacked with every other filter.
- Structured risk/2R can be compared as an exit module independently.

---

### V50 adaptive market-neutral ETF pair — preserve adaptive-selection idea

**Exact code components**
- Same 9-ETF universe as V26.
- 12-bar relative-return lookback.
- Strongest vs weakest ETF pair.
- Minimum cross-market dispersion 0.50%.
- Two experts: momentum vs reversion.
- Use last 6 completed observations to choose expert.
- Require recent expert edge > 0.075%.
- 120-minute hold.
- Estimated round-trip cost 0.06%.
- Gross 50/50 legs.
- Short leg must be shortable/easy-to-borrow.
- If neither expert has recent positive edge: stay cash.

**Status**
- Preserved as paper-forward candidate logic, not accepted as current baseline.
- No verified robust historical result in this ledger yet.

**Reusable pieces**
- Let recent evidence choose between competing playbooks rather than hard-coding one regime forever.
- “Cash” is a valid output.
- Cross-sectional dispersion can determine whether a relative-value opportunity even exists.
- Adaptive selector must itself be walk-forward tested to avoid chasing noise.

---

### V51 crypto forward-opportunity model — preserve state variables, not the retired whole strategy

**Exact code components**
- 1h, 6h, 24h returns.
- Relative 6h/24h returns versus BTC.
- 15m volume participation.
- Spread/friction.
- ATR context.
- Derived scores: persistence, acceleration, participation, relative pressure, friction.
- Opportunity score threshold 0.56.
- ATR-scaled stop; target ~1.8R.
- 1% risk fraction candidate, max 12% position, max 70% total crypto exposure, max 8% open risk.
- Maximum 60-minute hold.

**Status**
- Retired from active decision-making.
- No robust winner claim preserved here.

**Reusable pieces**
- Multi-horizon persistence.
- Acceleration relative to recent pace.
- Relative strength versus BTC.
- Participation/volume.
- Explicit spread/friction penalty.
- These are better candidates for **ranking/context features** than for becoming seven more hard gates.

---

## Known failed / weak families — retain the lesson, not a blanket ban

The following forms were rejected or weak in prior testing:
- Opening-gap candidates after correcting session indexing.
- Intraday gap/open-drive/fade families that did not generalize.
- Dedicated short-side families without robust positive candidates.
- Pair/relative-value attempts that failed validation.
- Cost-fragile candidates.
- Late-entry configurations.
- False-breakout-prone variants.
- Excessively correlated/concentrated portfolios.
- Over-filtered stacks that produced almost no qualified setups.
- Daily EMA200/EMA20 crypto pullback and anti-chase branches on broader historical validation.
- Breakout-strength gate (0.5-1.5 ATR) on new eligible crypto symbols.

These are **contextual failures**. If a future hypothesis changes the causal context, timeframe, market, or interaction, the component can be reconsidered—but only with a stated reason and an A/B test.

---

## Execution/data corrections that are never optional

- Signals use completed candles only.
- Entry occurs on the next eligible contiguous bar/open unless the strategy explicitly defines otherwise.
- Entry-bar stops are evaluated.
- Adverse gaps fill at the opening price in backtests.
- Stop wins same-bar stop/target ambiguity.
- Crypto trailing floors use prior completed information, not the current bar.
- Test boundaries are applied before indicator calculation.
- Shared-capital replay retains idle cash and actual entry/exit notional fees.
- Same-time allocation is deterministic.
- Risk/exposure caps are explicit.
- Raw per-symbol compounded returns are never presented as shared-capital portfolio returns.
- Broken authentication/data plumbing is not classified as a strategy failure.

---

## Component library

| Component | Evidence state | Best-known use | Main risk |
|---|---|---|---|
| 55-day breakout | Positive broad equity evidence; concentrated positive crypto evidence | Trend entry | Late entry / whipsaw |
| Prior-20-day-low exit | Positive in 55/20 equity; used in crypto breakout | Trend exit | Gives back open profit |
| EMA/SMA long-term trend filter | Useful context in V26 and other studies | Regime/context | Can over-filter |
| 63-day relative momentum ranking | Strong V26 history | Asset ranking/allocation | Regime concentration |
| RSI(2) oversold pullback | Positive V26 tactical sleeve | Mean-reversion entry inside uptrend | Different market regime |
| ATR stop | Repeatedly useful risk normalization | Stop/risk sizing | ATR expansion after entry |
| Fixed R target | Positive in tactical systems; mixed elsewhere | Exit module | Can truncate trends |
| Trailing exit | Useful in trend systems/C62 | Trend capture | Giveback / parameter sensitivity |
| BTC lead -> alt lag | Strong C60/C62 family evidence | Crypto entry | Relationship can change |
| Relative strength vs BTC | Useful C60/C62/V51 concept | Crypto ranking/context | Correlation regime shift |
| Structure confirmation | Useful in C62; over-filtering risk in equity stack | Context/confirmation | Low frequency |
| Bullish closed-candle breakout | C62 local confirmation | Crypto timing | Chase risk |
| Liquidity ranking | Useful tradability control, not proven alpha | Eligibility/execution | Concentration / false alpha |
| Volume participation | Plausible V51 context feature | Ranking/context | Noisy |
| Spread/friction penalty | Mechanically sound | Ranking/execution | Data quality |
| Adaptive momentum-vs-reversion selector | V50 concept worth preserving | Regime adaptation | Recency overfit |
| Cash/no-trade state | Mechanically valuable | Risk control | Missed moves |
| Staged entry / scale-in | C62 exit/risk layer | Risk deployment | Complicates attribution |

---

## First recombination hypotheses to test — research only

These are **experiments**, not changes to active baselines.

### H1 — C62 entry + V51 ranking features
Keep C62's exact binary setup unchanged. When multiple targets qualify at the same time, rank them by V51-style persistence/acceleration/relative-pressure/participation minus friction. Do **not** add those features as new entry gates.

**Reason:** uses V51 information without destroying C62 frequency.

### H2 — C62 entry + liquidity only as execution eligibility
Test whether excluding only genuinely illiquid/high-friction targets improves net expectancy after costs. Do not reward high liquidity as alpha.

**Reason:** prior research says liquidity helps tradability but did not prove predictive edge.

### H3 — C62 entry, exit-module tournament
Freeze the C62 entry and compare:
- original C60 exit if exact artifact is recovered,
- current C62 staged/ATR/3.25R/trailing exit,
- prior-20-bar/period low trend exit,
- simpler ATR stop + no fixed target.

**Reason:** separate entry-edge quality from exit engineering.

### H4 — 55/20 equity signals + V26-style ranking under cash contention
Do not block 55/20 signals. When cash cannot accept every signal, compare deterministic alphabetical allocation against ranking accepted signals by medium-term relative momentum / trend quality.

**Reason:** 55/20 already has more signals than 2.5% shared capital can fund; ranking may improve **which signals get capital** without reducing raw signal generation.

### H5 — 55/20 + correlation-aware allocation
Freeze entry/exit rules. Compare current cash-first acceptance with a portfolio allocator that penalizes highly correlated simultaneous positions while preserving the same total risk.

**Reason:** target DD/concentration without adding prediction filters.

### H6 — Separate trend + pullback sleeves
Run 55/20 trend breakout and V26 RSI(2) pullback as separate sleeves sharing portfolio risk, rather than combining their filters.

**Reason:** different edges may diversify; stacking the filters would likely eliminate trades.

---

## Missing evidence queue

Do not invent these. Recover source/artifacts:
- Exact original C55 rules and metrics.
- Exact original C60 result artifact to resolve +27.13/PF2.19 vs +28.88/PF2.26 fingerprint.
- V55/V56 exact rules and test results.
- V28/V30/V31/V32 exact component/result deltas.
- Any V36+ result tables not already in repository.
- Exact V50 historical validation metrics if they exist.
- Historical MACD Valley/Cross result set before it was activated in paper runtime.
- Trade-level winner/loser datasets for component-attribution analysis.

Every recovered item gets added here rather than replacing this ledger.
