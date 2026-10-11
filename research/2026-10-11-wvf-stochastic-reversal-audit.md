# Williams VIX Fix + Stochastic — research evidence, 2026-10-11

**Status:** historical exploratory test; **not validated for execution**, not approved for paper promotion or live trading. This file is preserved on an independent research branch; the frozen 55/20 equity and C62 crypto shadow baselines are unchanged.

## Origin and hypothesis
- User-supplied videos `3198.mp4` and `3199.mp4` suggest using Williams VIX Fix (WVF) to spot bottoms, with Stochastic confirmation and price action.
- Video presenter's custom Stochastic settings were not established; this test deliberately uses standard 14/3/3, **not** a claimed reproduction of private parameters.
- Explicit hypothesis: adding a recent WVF stress signal may improve entries from a 200EMA/20EMA/MACD trend-and-momentum **proxy**, or provide independent reversal entries. Test one gate at a time; do not automatically stack all conditions.
- **Important:** the 200/20 EMA + MACD proxy here is **not** the exact MomentumFlow production/paper crypto path. Repo currently freezes C62 crypto shadow and 55/20 equity shadow. New MACD crypto entries are paused; do not treat the historical proxy as C62 validation.

## Data and test contract
- Data: Alpaca US crypto OHLCV, 4-hour candles, BTC/USD, ETH/USD, SOL/USD, AVAX/USD, DOGE/USD.
- Coverage: 2024-10-11 through 2026-10-11 (4,380 requested candles per coin; exclude last potentially incomplete candle; 260-bar indicator warmup).
- Retrospective recent-period check: trades entered 2025-10-11 or later. Neither the 2024–25 nor the 2025–26 range is a future independent validation dataset. No optimization tournament was performed.
- Calculations: EMA20/EMA200; MACD 12/26/9 signal-cross; WVF = 100 × (highest close of previous/current 22 bars − current low) / highest close. WVF green if >= 20-bar SMA+2 population standard deviations, **or** >=85% of the trailing 50-bar WVF maximum. Stochastic 14/3/3, with rising %K crossing %D from near oversold; recent %K below 20.
- Entries next 4h open after completed signal bar; risk stop at minimum low of preceding 10 completed signal candles minus 0.2 × EMA-smoothed ATR14; profit target +2R; timeout at 36 × 4h bars (~6 days). Skip risk/price <0.3% or >12%.
- Intrabar ambiguity: stop wins a bar touching both stop and target; adverse open gaps executed at opening price; no lookahead or simultaneous overlapping trades per coin.
- Execution friction: 0.25% entry-side modeled fee plus 0.05% entry-side assumed slippage, and same at exit: **0.30% per side (0.60% round trip)**. The 0.05% slippage is assumed, not measured.
- Performance unit **R**: net outcome divided by initial price stop-distance. **Sum of R is NOT account return**; no shared-capital/portfolio overlap model, funding, borrow, or tax assessment. Per-coin risk-fraction equity simulations in scratch are **not** a combined shared-capital backtest.

## Five-coin 4-hour outcome

| Variant | Trades all | PF all | Net R all | Trades recent | PF recent | Net R recent |
|---|---:|---:|---:|---:|---:|---:|
| A: close > EMA20 > EMA200 + bullish MACD cross | 156 | 0.60 | -39.40 | 67 | 0.71 | -11.86 |
| B: A + WVF green within 12 candles | 110 | 0.62 | -24.71 | 46 | 0.64 | -9.40 |
| C: A + WVF green within 4 candles | 56 | 0.45 | -19.31 | 20 | 0.28 | -8.73 |
| D: WVF green <=12 candles, oversold Stoch + cross | 598 | 0.74 | -120.08 | 339 | 0.63 | -103.24 |
| E: D + close > EMA200 | 163 | 0.76 | -30.54 | 67 | 0.73 | -14.24 |
| F: D + close > EMA20 > EMA200 and MACD positive histogram | 0 | n/a | n/a | 0 | n/a | n/a |
| G: D + close > EMA200 + MACD histogram improving | 126 | 0.88 | -11.23 | 53 | 0.85 | -6.08 |

*PF = positive-trade R / absolute negative-trade R. Recent = 2025-10-11 onward. Stochastic crossing condition: K crosses above D, prior K or D below 25, K below 20 in preceding seven completed bars. Empty F means this stack is unusably restrictive under the stated definition.*

**Recent check:** A to B reduces trades from 67 to 46, and net total loss from -11.86R to -9.40R; **profit factor worsens from 0.71 to 0.64** and average per-trade result from -0.177R to -0.204R. This is not a demonstrated WVF edge.

**Variant G asset breakdown (full window):** BTC 31 trades / PF 0.59 / -11.14R; ETH 32 / 1.17 / +3.53R; SOL 23 / 0.72 / -5.40R; AVAX 19 / 0.84 / -2.36R; DOGE 21 / 1.35 / +4.14R. The two positive coins are small, **post-hoc** subgroups, not a vetted profitable deployment subset.

## Prior exploratory fingerprint; preserve separately
A preliminary 4-hour WVF/Stochastic reversal run used lower costs (0.15% per side), a differently smoothed ATR/boundary treatment, and did not use the same 260-candle warmup. It reported 624 trades, 36.9% wins, PF 0.91, -38.73R. A 4-hour Stochastic 8/3/3 sensitivity run reported 631 trades, PF 0.94, -25.17R at the same lighter friction. Another preliminary 1-hour 14/3/3 run over ~180 days reported 549 trades, PF 0.56 and -207.09R. **These are different backtest contracts. Do not combine or compare the raw totals as an optimizer search without re-running under a single frozen harness.**

## Interpretation and reusability
1. WVF is a **stress / potential-bottom context observation**, not sufficient causal evidence for reversal or an independently profitable entry.
2. Stochastic recovery after a WVF spike still enters many continuing selloffs. This suggests requiring evidence of *actual price recovery*, but that hypothesis **must be tested separately** and must not suppress needed trading frequency.
3. EMA200 and improving MACD can reduce harm, but they did not make the tested five-coin family profitable; hard gate stacking also reduced trade count severely.
4. High transaction friction matters and must be rechecked with actual tier fees, realized spreads, and slippage.
5. If revisited, test WVF **as a ranking/context variable**, holding existing frozen entries and exits intact, specifically checking incremental quality, frequency, leave-one-coin-out concentration, costs, and untouched later validation.
6. Do **not** transplant these proxy results into the frozen C62 crypto shadow or the 55/20 equity shadow; any C62-related hypothesis requires a separate identical-entry baseline vs one-change test on the exact C62 harness.

**Decision:** Preserve WVF, Stochastic, and combined-signal failures as reusable pieces, but **no production promotion, no active-bot code changes, no proof of profitability**.
