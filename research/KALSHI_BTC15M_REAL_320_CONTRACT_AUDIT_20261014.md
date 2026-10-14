# Kalshi BTC15M Real Historical Baseline Audit — 2026-10-14

**Verdict:** REJECT 15-minute quote-momentum and simple quote-reversal as standalone trading strategies. Preserve evidence, do not optimize these same thresholds on this window. No real or demo orders were placed.

## Data integrity
- Source: real `KXBTC15M` settled markets and one-minute YES bid/ask candles from Kalshi production public API, using GitHub Actions.
- 320 consecutive historical contracts across two non-overlapping, fixed 160-market batches.
- Prior: 2026-10-11T14:15Z through 2026-10-13T06:00Z.
- Recent: 2026-10-13T06:15Z through 2026-10-14T22:00Z.
- Both batches retrieved all 160 contract candles without download failures.
- Baselines frozen before results: relative movement of the contract's YES price from the fourth to the seventh minute, 4 percentage-point minimum absolute move. The quoted minute-eight YES ask or the complement of YES bid sets an **indicative**, not guaranteed, purchase price.
- Filters: buy price 10¢–85¢, spread no more than 10¢, one-minute trade volume positive.
- Capital: $1,000 synthetic bankroll **for each separate batch**; risk <=1% of equity and <=$5 per event; fees estimated via 7% * contracts * price * (1-price) rounded up to cents; $0.01 slippage per contract, plus adverse scenario $0.03.

## Main evidence

| Period | Rule | Eligible / 160 | Wins | Win rate | Paper P/L @ 1¢ slip | PF | DD | Paper P/L @ 3¢ slip |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Prior | Momentum | 84 | 48 | 57.14% | **-$40.35** | 0.764 | 6.21% | **-$52.30** |
| Prior | Reversal | 94 | 36 | 38.30% | **-$70.71** | 0.747 | 8.96% | **-$90.07** |
| Recent | Momentum | 81 | 52 | 64.20% | +$7.64 | 1.056 | 4.43% | **-$7.50** |
| Recent | Reversal | 92 | 34 | 36.96% | +$49.39 | 1.177 | 5.14% | +$10.90 |

All profits/losses are retrospectively **simulated fills using real quotes and actual settled outcomes**, NOT real executed or validated live profits. Some bid/ask quotes can disappear before a live order executes; actual trading may be worse.

## Interpretation
- Early negative testing invalidates claims based on the recent positive batch.
- Reversal's recent result contains a single approximately $34.05 hypothetical winner at 11¢ for 39 contracts, highlighting payoff skew / winner concentration rather than high-accuracy forecasting.
- Increasing slippage to 3¢ turns recent momentum negative.
- Reversal wins under 40% of eligible events in both periods. A low win rate is not inherently bad in prediction contracts, but its PF under 1 in the prior period disqualifies this configuration.
- These models follow/fade the *market-implied odds themselves* and do **not** estimate an independent true event probability, the prerequisite for reliable positive expected value.
- Do not add either to the live/paper executing bot. Preserve data to compare against independent probability sources (verified archived weather forecasts, price models), then test out-of-time and small-size forward paper.

## Reproducibility
- Pure tester: `momentumflow/kalshi15mBacktestCore.js`.
- Historical data runner: `momentumflow/kalshi15mRealBacktest.mjs`.
- Frozen GitHub Actions runs:
  - First recent: https://github.com/pakd33zy-jpg/Momentumfloww/actions/runs/38645629163
  - Recent + independent prior and slippage stress: https://github.com/pakd33zy-jpg/Momentumfloww/actions/runs/38645840496
- No API credentials needed and no order-entry code.

This research is separate from the equity 55/20 and crypto C62/MACD tracks, whose code/configuration must remain unchanged by these tests.
