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

### Crypto evolution: C55/V55 -> C56 -> C57 -> C60 -> C62

This chain is important because it shows how a weak/small-sample idea improved when individual pieces were changed instead of throwing the family away.

**C55 / V55 lead-lag core**
- BTC rises about 1% over 2 hours.
- Bullish, high-volatility regime.
- Targets: ETH, SOL, LINK.
- Target altcoin has only partially reacted to BTC.
- Direct closed-candle / next-bar entry.
- 1% round-trip cost assumption.
- Best recovered result: +17.14%, PF 1.82, 52.6% win rate, 19 trades.
- Folds: -1.95%, +8.12%, +10.97%.
- Max DD later referenced at 13.34%.
- Verdict: promising mechanism, but failed the >=30-trade / all-fold consistency bar.

**C56**
- Preserved BTC lead-lag.
- Changed timing to wait for a target pullback + closed-candle reclaim, then next-candle entry.
- 216 configurations.
- Only 1 qualifying trade.
- Verdict: rejected for extreme over-filtering / destroyed frequency.
- Reusable lesson: waiting for a “prettier” entry can erase the edge by arriving too late or almost never.

**C57**
- Restored the C55 direct entry.
- Tested a half/smaller starter plus confirmation add.
- 648 configurations.
- Best: +13.86%, PF 1.89, DD 9.67%, 19 trades.
- Folds: -1.70%, +8.01%, +7.55%.
- Improvement: lower DD than C55/V55 (13.34% -> 9.67%) without changing the entry mechanism.
- Failure: sample stayed at 19 trades and first fold stayed negative.
- Reusable lesson: staged sizing can improve risk even when it does not fix entry robustness.

**C60**
- Removed the C59 mean-reversion branch and audited the momentum/lead-lag family across folds, coins, leave-one-coin-out, and 0.5% / 1.0% / 1.5% friction.
- Best verified historical audit: +27.13% after 1% friction, PF 2.19, DD 5.90%, 33 trades.
- All folds profitable.
- ETH, SOL, LINK each profitable.
- Leave-one-coin-out survived.
- Still +10.63% at 1.5% friction.
- Failure/limitation: 33 trades remained below the desired 50-trade confidence target.
- Reusable lesson: removing a conflicting mean-reversion branch and auditing across assets/regimes improved the family more than adding another entry filter.

**C62**
- Preserved C60's validated momentum signal.
- Changed hold time, cooldown, and trailing exits to seek more opportunities without weakening the entry.
- Live/shadow implementation used exact closed-candle signal, ATR stop/target, half-size starter, add only after +1R.
- Best recovered historical result: +31.75% after 1% friction, PF 2.33, 48.5% win rate.
- All folds and all coins profitable.
- Leave-one-coin-out survived.
- +15.25% at 1.5% friction.
- Still 33 trades, so it was **not promoted as proven**.
- Reusable lesson: better exits/risk can improve the same entry family, but they do not manufacture more independent observations.

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

### V30 / V31 equity research — strong headline, fold robustness problem

**V30 recovered result**
- Full return: +58.73%.
- CAGR: 9.53%.
- Sharpe: 0.845.
- Max DD: -10.62%.
- PF: 1.78.
- Win rate: 57.38%.
- 122 cycles.
- 4x costs: +27.17%.
- Robustness failure: 0/48 folds passed; fold 1 was -1.02%.
- Verdict: rejected despite attractive full-sample headline.

**V31 intended change**
- Removed a weak defensive-bond idea.
- Added an SPY trend/shock cash brake to V30's strongest long/cash-relative family, specifically targeting 2022 deterioration.
- Research tooling later added a 48-config tournament, qualification-failure diagnostics, survivor funnel, and bottleneck summary.
- A software isolation bug initially contaminated V31 with V30 shared functions; tests were 109/110 with one failure before research. That is an implementation failure, not evidence against the strategy idea.
- Final V31 tournament metrics remain unverified.

**Reusable lessons**
- High full-sample return + PF can still be rejected when fold robustness is poor.
- A regime cash brake is a valid hypothesis when a specific bad regime is identified, but must be tested without contaminating prior-version code.
- Software/test failures must be separated from strategy failures.

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

## New recombination evidence — 2026-10-07

### 55/20 + V26 63-session same-open ranking
- Liquid20: 201 raw signals, 201 accepted, 0 skipped; alphabetical and momentum63 both +23.624%, recent +3.755%, DD 9.061%.
- Liquid50: 496 raw signals, 493 accepted, 3 skipped; both +28.361%, recent +7.333%, DD 13.307%.
- Conclusion: same-open ranking is ineffective because most cash contention comes from older positions already occupying capital, not multiple new signals competing at one open.
- Preserve as a failed placement of a good component. Momentum ranking may still matter as portfolio priority/weighting, not same-open tie-break.

### Recovered C62 source vs historical C60 fingerprint
The exact C62 source recovered from the old branch does **not** reproduce the historical C60 robustness fingerprint on broader direct Alpaca 15m data using causal next-bar execution and 1% round-trip cost.

**Recent 180d, exact recovered lead-lag entry**
- C62 staged exit: +19.80%, PF 3.75, DD 3.05%, 15 trades.
- Fixed target: +24.19%, PF 2.67, DD 6.06%, 15 trades.
- Trailing-only: +26.89%, PF 2.86, DD 6.06%, 15 trades.
- 20-bar-low exit: +24.20%, PF 2.54, DD 6.56%, 15 trades.
- ATR-stop + 24h time exit: +30.93%, PF 3.37, DD 6.06%, 14 trades.
- This looked promising but was explicitly **not promoted** because the sample was tiny.

**Latest 365d**
- C62 staged exit: -0.04%, PF 1.03, DD 18.29%, 33 trades.
- Fixed target: -2.69%, PF 0.98, DD 23.71%, 33 trades.
- Trailing-only: +2.22%, PF 1.10, DD 21.75%, 33 trades.
- 20-bar-low exit: -5.69%, PF 0.91, DD 28.18%, 33 trades.
- ATR-stop + 24h time exit: -2.14%, PF 1.00, DD 29.56%, 32 trades.
- At 1.5% friction every tested exit variant was negative.

**Prior independent 365d fold: 2024-10-08 through 2025-10-07**
- Current 0.6% BTC 2h impulse threshold: -44.49%, PF 0.38, DD 53.79%, 60 trades.
- 0.8% threshold: -46.41%, PF 0.24, DD 50.03%, 44 trades.
- 1.0% threshold (older C55 clue): -42.48%, PF 0.14, DD 43.26%, 35 trades.
- 1.2% threshold: -37.00%, PF 0.12, DD 37.11%, 27 trades.
- Every ETH/SOL/LINK result was negative for the 1.0% variant in this fold.

**Entry-edge isolation on the same bad fold**
- 512 historically motivated entry combinations were tested around BTC impulse, BTC volatility, lag fraction, target structure, bullish candle, and local breakout.
- With C62 exit: zero configurations with >=20 trades were positive with PF > 1.
- With fixed 6h/12h/24h forward returns at 1% cost: zero configurations with >=20 trades were positive with PF > 1.
- Therefore this is not merely an exit problem in that fold; the reconstructed entry family itself lacks edge there.

**Old C58 higher-timeframe context recombination**
A declared hypothesis—not claimed as exact C58 reconstruction—required positive BTC 7-day and 20-day returns on top of the ~1% lead-lag entry.
- No HTF gate: 45 trades, -48.1%, PF 0.44 on fixed 24h forward returns.
- BTC 7d positive: 37 trades, -47.3%, PF 0.40.
- BTC 20d positive: 42 trades, -47.8%, PF 0.42.
- Both positive: 37 trades, -47.3%, PF 0.40.
- Stronger 7d >3% and 20d >5%: 31 trades, -37.5%, PF 0.48.
- Conclusion: this particular HTF-strength interpretation does not rescue the bad fold.

**Critical provenance conclusion**
- The recovered C62 live-source file must **not** be treated as proof that the historical C60 +27.13% / PF 2.19 / 5.90% result has been reproduced.
- The historical C60 audit remains a separate artifact/result whose exact parameter implementation is still missing.
- Preserve both facts rather than forcing them to agree.

### C59 -> C60 subtraction lesson
- C59 momentum branch: +19.04% across 37 trades.
- C59 range mean-reversion branch: -119.39%.
- C60 was created by removing the range mean-reversion branch completely and then auditing nearby momentum configurations.
- Reusable lesson: major improvement can come from **removing a conflicting component**, not adding filters.

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

## Cross-version deduction: regime is now the highest-value crypto question

The C62 entry/exit ablation produced a useful contradiction:
- Recent year: same lead-lag entry can be profitable, especially with trailing exits.
- Prior year: the same entry family loses heavily regardless of exit choice.

That means the next research step should not be “find a better stop” or “add another candle pattern.” It should test whether **broad regime state** explains when the lead-lag relationship has positive expectancy.

Candidate regime pieces already earned the right to be tested because they came from earlier work:
- V26: long-term trend state (SMA150 / medium-term momentum).
- V31: trend/shock cash brake aimed at bad regimes.
- C60 description: bullish, high-volatility BTC regime.
- V51: multi-horizon persistence / acceleration / relative-pressure context.

Use these as competing regime hypotheses, one at a time, around the frozen C62 entry. Do not stack them all.

## C62 regime test 1 — V26 BTC trend state

**Tested 2026-10-08; research only; active C62 unchanged.**

Frozen C62 replay plus one causal regime gate: at the C62 signal close, the most recent fully completed BTC daily candle must satisfy **close > SMA150** and **63-day momentum > 0**. No other entry filters were added.

**Consistent direct-Alpaca replay provenance check**
- Prior window 2024-10-07 -> 2025-10-07: 60 trades, **-44.37%**, PF **0.384**, DD 53.81%. This closely reproduces the saved -44.49% / PF 0.38 failure on return and PF; the DD-accounting difference remains unresolved.
- Recent window 2025-10-08 -> 2026-10-08: 33 trades, **+0.70%**, PF **1.053**, DD 18.08% under the same replay mechanics.
- That recent replay does **not** reproduce the saved +13.87% / PF 1.62 / DD 7.74 fingerprint even though the accepted-trade count remains 33. Preserve both fingerprints and treat the recent positive fingerprint as a provenance/reproducibility item until trade-level source matching resolves the discrepancy.

**V26 BTC regime gate result**
- Recent window: 8 trades, **+8.87%**, PF **3.096**, DD 3.05%; only 24.2% of the consistent 33-trade baseline survives.
- Prior window: 46 trades, **-35.28%**, PF **0.446**, DD 46.27%.
- The prior window had 81 raw C62 signals before overlap/position blocking; 67 passed the V26 daily state, so the gate removed relatively little of the bad regime.

**Verdict: reject this exact combined V26 hard gate as a standalone C62 regime discriminator.** It improves the losing year but leaves it deeply negative, while deleting roughly three quarters of the recent accepted trades. Do not retest this exact gate unchanged. SMA150 and 63-day momentum remain reusable components in other contexts.

Full note: research/C62_V26_BTC_REGIME_TEST_2026-10-08.md


## C62 regime test 2 — V31 BTC trend/shock hard brakes

**Attempted 2026-10-08; research only; active C62 unchanged.**

Recovered the exact V31 trend/shock logic from AdaptiveConfluenceLab and ported only the BTC-mappable hard-cash predicates. No synthetic crypto breadth proxy was invented.

**Provenance gate**
- The older window had to reproduce approximately the known 60-trade C62 baseline before filtered results could be trusted.
- The Render replay returned only 6 baseline trades because historical altcoin coverage was incomplete: SOL/USD and LINK/USD each returned only 577 bars.
- The runner stopped automatically and skipped the recent window.
- Any superficially improved filtered metric from that incomplete sample is invalid and is **not strategy evidence**.

**Verdict: no V31 verdict; data provenance failed.**
- Do not mark V31 passed or failed.
- A future attempt must first reproduce the known C62 trade-count fingerprint.
- Keep the V31 source rules as reusable hypotheses, but do not parameter-mine around this invalid replay.

Operationally, this investigation also exposed Alpaca market-data rate-limit collisions among paper/shadow processes. Shared request pacing/retry was added and 55/20 bar access was routed through it while preserving adjusted-bar behavior. Treat that as execution reliability work, not alpha evidence.

Full note: research/C62_V31_BTC_REGIME_ATTEMPT_2026-10-08.md

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
Freeze the C62 entry and compare exit modules.

**Fresh 365-day causal Alpaca test (ETH/SOL/LINK, BTC leader, 15m, 1.0% modeled round-trip cost, entry at next 15m bar open)**
- C62 staged + 3.25R target + trail + 24h max: 33 trades, +13.87%, PF 1.62, DD 7.74%.
  - Early half: -1.37%, PF 0.90.
  - Late half: +15.46%, PF 2.43.
- Fixed 3.25R target, no staging/trailing: 33 trades, -2.69%, PF 0.98, DD 15.30%.
- 2.5R trigger / 1.5R trailing stop, **no fixed target**, no staging: 33 trades, +33.87%, PF 1.90, DD 11.33%.
  - Early half: +6.11%, PF 1.37.
  - Late half: +26.17%, PF 2.58.
  - ETH +8.84% PF 2.90; SOL +0.12% PF 1.05; LINK +22.85% PF 2.86.
- Prior-20-bar-low exit: 36 trades, -28.66%, PF 0.37, DD 34.62%.
- Bare ATR stop + 24h max, no target/trail: 32 trades, -2.14%, PF 1.00, DD 21.36%.

**Execution check**
- Re-running current C62 with signal-close fills produced only +7.21%, PF 1.31, DD 9.56%.
- Next-bar-open fills were **better**, not worse, in this window; this means the positive result is not coming from an optimistic signal-close fill assumption.

**Parameter/cost stress around the no-target trailing exit**
- 2.5R trigger / 1.0R trail @ 1.0% cost: +38.18%, PF 2.00, DD 11.33%, 33 trades.
  - ETH +10.26%, PF 3.19.
  - SOL **-5.51%, PF 0.72**.
  - LINK +32.63%, PF 3.56.
- 2.0R trigger / 1.0R trail @ 1.0% cost: +34.09%, PF 1.86, DD 12.39%, 34 trades.
  - SOL **-8.30%, PF 0.61**.
- 2.5R trigger / 1.5R trail @ 1.0% cost: +33.87%, PF 1.90, DD 11.33%, 33 trades.
  - ETH +8.84%, PF 2.90.
  - SOL +0.12%, PF 1.05.
  - LINK +22.85%, PF 2.86.
- 2.5R / 1.5R at 1.25% cost: +23.34%, PF 1.59, DD 13.21%.
- 2.5R / 1.5R at 1.50% cost: +13.62%, PF 1.35, DD 15.17%; SOL turns negative (-6.20%, PF 0.76).
- 2.5R / 1.0R at 1.50% cost: +17.29%, PF 1.43, DD 15.72%; SOL also negative (-11.50%, PF 0.49).

**Interpretation**
- The entire neighborhood remains profitable in aggregate at 1.0% cost, so the no-target trailing result is not a one-parameter spike.
- Tighter trailing raises aggregate return mostly by helping ETH/LINK, but hurts SOL materially.
- 2.5R / 1.5R is currently the more balanced 1.0%-cost variant because all three coins remain positive, even though it is not the highest headline return.
- Cost stress exposes fragility in SOL. Do not call the exit robust yet.
- Next required test: prior non-overlapping year with the same frozen entry and the same small exit neighborhood.

**Independent prior-year failure — 2024-10-07 to 2025-10-07**
- Same frozen C60/C62 entry, next-15m-open execution, 1.0% modeled round-trip cost.
- Current C62 staged/target/trail: 60 trades, **-44.49%**, PF **0.38**, DD 47.33%.
  - ETH -13.74%, PF 0.45.
  - SOL -18.22%, PF 0.52.
  - LINK -21.31%, PF 0.07.
- 2.5R trigger / 1.5R no-target trail: 60 trades, **-57.36%**, PF **0.36**, DD 60.89%.
- 2.5R trigger / 1.0R trail: 60 trades, **-55.75%**, PF **0.39**, DD 59.81%.
- 2.0R trigger / 1.0R trail: 60 trades, **-57.55%**, PF **0.35**, DD 60.87%.
- At 1.5% cost the 2.5R/1.5R trail worsened to -68.57%, PF 0.25.

**What this changes**
- The recent-year positive result is **not robust across a prior non-overlapping year**.
- The failure is not primarily an exit problem: every tested exit family failed in the older window.
- Therefore the next research question moves upstream: **what regime/context made the same lead-lag entry work recently and fail badly before?**
- Do not discard the entry family. Preserve it as a regime-dependent component and search for a causal context discriminator using already-tested pieces (V51 persistence/relative-pressure/participation, broader BTC trend/regime, volatility state, and friction).
- Active C62 forward shadow remains unchanged so forward evidence is not contaminated by retrospective tuning.

**Current conclusion**
- The C60/C62 lead-lag **entry mechanism still shows positive evidence** on fresh causal data.
- The fixed 3.25R target appears to cut off too much trend upside.
- The prior-20-low trend exit is incompatible with this short-horizon lead-lag entry.
- The no-target trailing exit is the current research leader, but 33 trades is still a small sample and SOL was only barely positive. It must survive cost stress, parameter-neighborhood checks, and another independent window before promotion.
- Active C62 shadow remains unchanged; this is research only.

### H4 — 55/20 equity signals + V26-style ranking under cash contention
Do not block 55/20 signals. When cash cannot accept every signal, compare deterministic alphabetical allocation against ranking accepted signals by 63-session momentum.

**Reason:** 55/20 already has more signals than 2.5% shared capital can fund; ranking might improve **which signals get capital** without reducing raw signal generation.

**First test result — useful failure**
- Liquid20 direct Alpaca replay: 201 raw signals, 201 accepted, 0 skipped. Alphabetical and momentum63 both returned +23.624%, recent +3.755%, DD 9.061%. No difference because there was no cash contention.
- Liquid50 direct Alpaca replay: 496 raw signals; 493 accepted, 3 skipped; 99.4% capture. Both methods returned +28.361%, recent +7.333%, DD 13.307%. No difference.
- There were 2 Liquid50 days with cash-related skips, but momentum ordering did not change the allocation on those days.

**Conclusion:** same-open tie-breaking is **not the right place** to use V26 momentum. Most cash contention comes from capital already tied up in older 55/20 positions, not several new signals fighting for the same morning's cash. Preserve this result. Do not keep retesting the same tie-break idea unchanged.

**Next derivative hypothesis:** use momentum as an allocation/weighting or portfolio-priority layer that can affect capital already deployed, while keeping the 55/20 signal generator frozen in research comparisons.

### H5 — 55/20 + correlation-aware allocation
Freeze entry/exit rules. Compare current cash-first acceptance with a portfolio allocator that penalizes highly correlated simultaneous positions while preserving the same total risk.

**Reason:** target DD/concentration without adding prediction filters.

### H6 — Separate trend + pullback sleeves
Run 55/20 trend breakout and V26 RSI(2) pullback as separate sleeves sharing portfolio risk, rather than combining their filters.

**Reason:** different edges may diversify; stacking the filters would likely eliminate trades.

---

## Missing evidence queue

Do not invent these. Recover source/artifacts:
- Original C55/C60 raw result artifacts and trade lists (rules/metrics are now recovered from prior research conversations, but raw provenance should still be matched).
- Resolve the later +28.88% / PF 2.26 C60 recap against the verified +27.13% / PF 2.19 audit; do not blend them.
- V28 exact component/result deltas.
- V31 final tournament metrics after software-isolation repair.
- V32 exact strategy metrics; current recovered evidence only proves its paper-forward blocker was HTTP 401, not a logic failure.
- Any V36+ result tables not already in repository.
- Exact V50 historical validation metrics if they exist.
- Historical MACD Valley/Cross result set before it was activated in paper runtime.
- Trade-level winner/loser datasets for component-attribution analysis.

Every recovered item gets added here rather than replacing this ledger.
