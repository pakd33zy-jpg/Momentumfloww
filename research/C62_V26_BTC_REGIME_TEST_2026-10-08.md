# C62 x V26 BTC Regime Test — 2026-10-08

Research-only. No active strategy rules changed.

## Question

Can the V26 long-term BTC trend state separate the recent C62 regime from the prior-year failure while leaving the frozen C62 lead-lag entry and current-style C62 exit/risk layer unchanged?

## Frozen C62 replay rules

- Targets: ETH/USD, SOL/USD, LINK/USD; BTC/USD is the leader.
- Closed 15-minute candles only.
- Entry logic is the source-recovered C62 logic.
- Entry at the next contiguous 15-minute bar open.
- Current-style C62 exit/risk layer:
  - 2.5 ATR stop distance.
  - 3.25R fixed target.
  - 24h max hold.
  - Trail activates after +2.5R with 1.5R distance and breakeven floor.
  - 50% starter, remaining 50% add at +1R.
- 1.0% modeled round-trip cost.
- Entry-bar stops evaluated.
- Adverse stop gaps fill at the bar open.
- Stop wins same-bar stop/target ambiguity.
- Trailing stop uses the prior completed peak, not current-bar future information.

## V26 BTC regime hypothesis

At the C62 signal close, use only the most recent fully completed BTC daily candle.

Allow the C62 trade only when BOTH are true:

1. BTC daily close > BTC SMA150.
2. BTC 63-day momentum > 0.

This is one V26 eligibility concept; no other filters were stacked.

## Baseline provenance check

### Prior window: 2024-10-07 to 2025-10-07

Consistent direct Alpaca replay:
- 60 accepted trades.
- Return: **-44.37%**.
- Profit factor: **0.384**.
- Max drawdown under this replay accounting: **53.81%**.

This reproduces the saved prior-year C62 fingerprint closely on return and PF:
- Saved: -44.49%, PF 0.38.
- Drawdown accounting still differs from the saved 47.33% and remains a provenance item.

### Recent window: 2025-10-08 to 2026-10-08

Consistent direct Alpaca replay:
- 33 accepted trades.
- Return: **+0.70%**.
- Profit factor: **1.053**.
- Max drawdown: **18.08%**.

This does NOT reproduce the previously saved recent fingerprint of +13.87%, PF 1.62, DD 7.74% even though the trade count remains 33.

Therefore the saved recent positive result is currently **not independently reproducible under the same consistent replay mechanics that reproduce the older failure**. Preserve both fingerprints; do not overwrite or average them. The recent result needs trade-level/data-provenance reconciliation before it is treated as verified evidence.

## V26 regime result

### Recent window

V26 BTC regime gate:
- 8 accepted trades.
- Return: **+8.87%**.
- Profit factor: **3.096**.
- Max drawdown: **3.05%**.

Trade capture versus the 33-trade consistent baseline: **24.2%**.

### Prior window

V26 BTC regime gate:
- 46 accepted trades.
- Return: **-35.28%**.
- Profit factor: **0.446**.
- Max drawdown: **46.27%**.

The older window contained 81 raw C62 signals before overlap/position blocking; 67 passed the V26 daily regime test. The gate therefore removed relatively little of the bad regime.

## Verdict

**Reject the combined V26 BTC SMA150 + positive-63d-momentum rule as a standalone C62 regime discriminator.**

Why:
- It improves the bad year but leaves it strongly negative.
- It removes about three quarters of the recent accepted trades.
- It filters the recent window much more aggressively than the old losing window, the opposite of what a useful regime discriminator should do.
- The 8-trade recent filtered sample is too small to justify promotion even though its headline metrics are positive.

Reusable evidence:
- SMA150 and 63-day momentum remain valid research components.
- This exact combined hard gate should not be retested unchanged around C62.
- No change to the active C62 paper shadow.
- No change to 55/20.

## Next research step

Recover the exact V31 trend/shock cash-brake rule from source before testing it around the frozen C62 entry. Do not invent a substitute rule from the description.
