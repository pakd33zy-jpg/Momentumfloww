# Causal EMA/MACD entry-filter ablation — 2026-10-13

**Verdict: NO ROBUST WINNER. Research-only.**

## Method
The previous [exit ablation](ema_macd_2026-10-13.md) established a MACD 12/26/9 up-cross entry with `close > EMA20 > EMA200` on a fully closed hourly candle and **exit when the closed-hour price falls under EMA200, executing at next hourly open**. This follow-up changes **exactly one entry condition at a time**, preserving the exit, fill timing, full-notional sizing, indicator warmup, and **0.25% cost per side** (0.5% estimated round trip, fee+slippage combined). No order execution or account credentials.

Added single-condition screens:
- `macd_positive`: MACD line above zero at signal close
- `ema200_rising_48h`: current EMA200 greater than its value 48 closed hours earlier
- `momentum_24h_over_1pct`: last 24-hour close-to-close increase strictly above 1%
- `breakout_prior_24h`: last closed price above the maximum high in the *preceding* 24 fully closed hours
- `volume_over_1p5x_prior_24h`: signal-bar volume at least 1.5× mean of 24 *prior* closed-hour volumes

**Three crypto assets:** BTC-USD, ETH-USD, SOL-USD using Coinbase Exchange historical public hourly bars (2024-10-01 through 2026-10-12 inclusive for indicator warmup). Exact source hashes and filled-gap counts in [machine-readable results](ema_entry_ablation_2026-10-13.json). Every coin had the same two five-hour outages already documented in the earlier report; filled only with prior known close, zero volume, no lookahead. 17,808 data hours each including 10 causal synthetic fills.

**Evaluation periods:**
1. early_2024_25: 2024-11-01 to 2025-03-09 (129 days)
2. older_2025: 2025-03-10 to 2025-10-12 (217 days)
3. newer_2025_26: 2025-10-13 to 2026-10-12 (365 days)

**Critical:** The newer period was already reviewed in earlier experiments and **is not a fresh untouched out-of-sample holdout**. This screen is exploratory. Its limited winning cells must not be optimized against or promoted to paper copy-trading without a new independent validation period. These BTC/ETH/SOL results are not AlphaInsider performance results; they are separate simulated hourly strategies.

## Net results

Table cells are **compounded net return % / max mark-to-market drawdown % / closed trades**.

| Variant | BTC early | BTC older | BTC newer | ETH early | ETH older | ETH newer | SOL early | SOL older | SOL newer |
|---|---|---|---|---|---|---|---|---|---|
| MACD+EMA entry, EMA200 exit | +4.40 / 25.0 / 15 | +3.25 / 12.6 / 26 | -15.52 / 31.2 / 32 | -29.51 / 38.2 / 20 | +51.05 / 28.2 / 26 | -29.17 / 36.3 / 46 | +19.19 / 25.0 / 8 | -15.46 / 43.4 / 26 | -17.82 / 44.0 / 48 |
| MACD > 0 | +17.94 / 15.3 / 10 | -1.60 / 12.2 / 20 | -15.73 / 30.4 / 27 | -27.32 / 36.3 / 13 | +54.78 / 28.8 / 20 | -25.77 / 32.4 / 33 | +23.97 / 22.0 / 6 | -6.17 / 41.2 / 20 | -11.90 / 43.2 / 31 |
| EMA200 up over 48h | -2.63 / 25.3 / 14 | +8.42 / 11.1 / 24 | -11.41 / 27.8 / 28 | -27.11 / 36.1 / 19 | +10.10 / 28.5 / 25 | -28.36 / 36.4 / 39 | +19.06 / 25.1 / 8 | -26.80 / 46.9 / 24 | -12.99 / 36.2 / 40 |
| 24h momentum > +1% | +11.33 / 21.0 / 8 | -6.62 / 12.8 / 16 | -11.17 / 25.3 / 18 | -28.73 / 37.5 / 11 | +19.61 / 30.5 / 16 | -19.13 / 26.5 / 25 | +24.09 / 21.9 / 6 | -14.65 / 39.8 / 19 | -11.53 / 43.0 / 24 |
| Close > previous 24h high | +9.65 / 22.2 / 8 | +6.05 / 10.2 / 14 | -13.32 / 22.0 / 12 | -12.21 / 21.6 / 5 | +8.02 / 27.8 / 11 | -24.76 / 27.0 / 13 | +35.33 / 18.9 / 3 | -4.35 / 26.4 / 11 | +8.34 / 32.7 / 13 |
| Volume > 1.5× previous 24h average | -2.15 / 29.7 / 13 | +0.18 / 12.2 / 17 | -10.77 / 26.1 / 20 | -16.85 / 25.8 / 11 | +33.95 / 34.3 / 15 | -20.76 / 31.9 / 27 | +35.18 / 18.9 / 3 | -19.95 / 31.8 / 15 | -17.52 / 30.7 / 24 |

## Analysis and decision
- **None** of the six entry definitions made money across every asset and every period. The early ETH window was negative for every variant.
- **Newer window:** 17 of 18 asset/variant combinations lost money. The only positive result was **SOL +8.34%** for the 24-hour breakout screen, with **32.70% drawdown and 13 completed trades in 365 days**. That is insufficient activity and excessive drawdown for the project's requirements.
- The entry screens generally lowered turnover, but not enough to produce a reliable edge. An apparent improvement in one asset/regime often corresponded to losses in others.
- Do **not** switch MomentumFlow's running paper strategy to these proxy variants. No copy trades or real trades authorized.

## Reproduction
- [Research script](../ema_entry_ablation.py): `python3 momentumflow/research/ema_entry_ablation.py --cache-dir /tmp/ema-macd-research`
- [Offline unit tests](../test_ema_entry_ablation.py): `python3 -m unittest discover -s momentumflow/research -p 'test_ema*.py' -v`
- [Complete JSON results](ema_entry_ablation_2026-10-13.json): one record per asset, per window, per variant with returns, drawdown, profit factor, round trips and recent trade activity.
- Includes previously saved baseline script and exit experiments; no prior results were deleted.

## Next controlled hypothesis
Before changing another indicator, compare a **longer-horizon entry with fewer expected round trips** or a **risk-limited position size** against a genuinely new instrument and later time period; use a locked, predeclared rule and realistic broker fees. Explicitly measure market exposure and trade frequency rather than assume a high number of trades implies more profit.
