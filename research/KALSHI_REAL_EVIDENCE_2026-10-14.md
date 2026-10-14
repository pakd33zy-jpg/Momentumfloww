# Kalshi real-market historical evidence — 2026-10-14

**Status: NO validated profitable Kalshi strategy. Historical simulations only. No orders were placed.**

## Source and safeguards

Public Kalshi production archive and recent market-data APIs. Every contract has a real settled YES/NO result and minute-by-minute Kalshi bid/ask candles. No synthetic outcomes. P&L uses indicative historical closing asks, modeled 1-cent adverse slippage, and the generic 7% * quantity * price * (1-price) Kalshi fee estimate rounded to cents. These are **not actual executable fills** or proven returns, and contract-specific fees and actual market depth need further validation.

## Frozen recent-period baseline A (2026-10-11 to 2026-10-14)

The identical BTC15M 4-cent midpoint momentum/reversal baseline was tested on two adjacent nonoverlapping sets of **160 settled markets each**. Rules: $1,000 virtual starting balance for each run, <=$5 exposure per eligible bet, 10c maximum quote spread, 10c–85c entry band, nonzero entry volume, 1-cent adverse slippage, estimated fees.

| Market sample | Strategy | Trades | Wins | Win rate | Net simulated P&L | PF |
|---|---|---:|---:|---:|---:|---:|
| Prior 160 markets | momentum | 84 | 48 | 57.14% | **-$40.35** | 0.764 |
| Recent 160 markets | momentum | 81 | 52 | 64.20% | **+$7.64** | 1.056 |
| Prior 160 markets | reversal | 94 | 36 | 38.30% | **-$70.71** | 0.747 |
| Recent 160 markets | reversal | 92 | 34 | 36.96% | **+$49.39** | 1.177 |

Recent reversal profit was materially affected by a single $34.05 simulated winner. **Neither baseline passes independent adjacent-period validation.**

Runs: [prior + recent parallel](https://github.com/pakd33zy-jpg/Momentumfloww/actions/runs/38645840496).

## Archived baseline B, a DIFFERENT predeclared rule set (2026-06-01 to 2026-08-13)

Archive probe found that archival candle prices are in `yes_bid.close` / `yes_ask.close`, not only `.close_dollars`. The corrected archived runner browsed 7,000 historical KXBTC15M listings, sampled 130 systematically across approximately 73 days, and found 120 eligible direction signals. Used 3-cent quote-midpoint momentum threshold, max 1% of simulated equity per bet, $1,000 starting account, 1-cent adverse slippage and modeled fees. **This differs from baseline A; do not pool its numbers as an identical-strategy validation.**

| Method | Trades | Win rate | P&L | PF | Max DD |
|---|---:|---:|---:|---:|---:|
| Momentum, all | 76 | 69.74% | **+$53.03** | 1.221 | 7.07% |
| Momentum, first 70% | 50 | 74% | +$70.55 | 1.518 | 4.36% |
| Momentum, final 30% holdout | 26 | 61.54% | **-$15.87** | 0.835 | 5.90% |
| Reversal, all | 89 | 26.97% | **-$155.21** | 0.712 | 24.45% |

The archive momentum holdout **failed**. Never present the +$53.03 or 69.7% winning trades as a proven bot edge.

Run and full trade-log artifact: https://github.com/pakd33zy-jpg/Momentumfloww/actions/runs/38645981296

## Reusable findings and next research steps

1. Quote-direction accuracy can be high but does not establish positive expected value; entry contract prices and losses matter.
2. BTC15M quote momentum can appear profitable in one regime and lose in the next. Never cherry-pick the recent profitable block or the older archive in isolation.
3. Retain midpoint-price momentum as a possible *feature*, not a standalone replacement. Reversal lacks reliable evidence.
4. Next comparison should use the **same** exact fixed entry/fee/sizing rules across all time windows; archived and recent candle schemas must both be supported. Perform additional untouched chronological holdout, fee/slippage and order-book-depth sensitivity, and prospective demo-paper logging. Stop if results fail.
5. No Martingale, no live-money activation, no claims of a guaranteed winner.

## Separate market tracks preserved

Equities: 55/20 Liquid100 is the documented historical baseline; further independent forward-shadow results required. Crypto: C62 cross-year tests showed inconsistent/negative years; treat C62 as a regime-dependent component and preserve old C60 evidence until independently reproduced. Do not change active trading paths based on these Kalshi backtests.
