# Kalshi BTC15M — identical frozen 4¢ baseline on real older archive
**Checked 2026-10-14. Verdict: NOT VALIDATED.**

This run repeats the EXACT `momentumflow/kalshi15mBacktestCore.js` signal and trade rules from the adjacent 320-contract Oct 11–14 study, without threshold retuning.

## Data

- Public Kalshi PRODUCTION archived 15-minute Bitcoin markets.
- Read-only, no keys, no orders. Actual YES/NO settlement results and historical one-minute bid/ask candles, with simulated purchases.
- 7 archival API pages with 7,000 eligible contract listings. Systematically selected 210 contracts, independently of their outcome, from 2026-06-02 through 2026-08-14. 209 had retrieved candles; one returned HTTP 429 after retries.
- Each of the three chronological blocks has 70 selected contracts.
- Frozen 4¢ price-momentum signal or its reversal, minute-8 ask, 10¢ spread cap, 10¢–85¢ entry-price band, nonzero historical entry volume, 1¢ per-contract adverse slippage, estimated Kalshi fee and <=$5 (<=1%) simulated stake, $1,000 hypothetical starting balance **per fold**. Also 3¢ adverse slippage stress.
- **Not real executed fills**. A historic minute-end quote does not prove order-book depth and fill probability.

## Same-rule independent historical results

| Method | Sample | Trade count | Win rate | Simulated net P&L (1¢ slippage) | Profit factor | 3¢ slippage net P&L |
|---|---|---:|---:|---:|---:|---:|
| Momentum | Early 70 | 28 | 67.86% | +$11.68 | 1.273 | +$7.32 |
| Momentum | Middle 70 | 34 | 73.53% | +$11.73 | 1.280 | +$5.12 |
| Momentum | Late 70 | 38 | 55.26% | **-$23.63** | 0.704 | **-$28.88** |
| Momentum | All 210 | 100 | 65.00% | **-$0.22** | 0.999 | **-$16.44** |
| Reversal | Early 70 | 32 | 28.13% | -$64.26 | 0.422 | -$66.95 |
| Reversal | Middle 70 | 41 | 21.95% | -$69.81 | 0.550 | -$77.73 |
| Reversal | Late 70 | 46 | 36.96% | -$1.23 | 0.991 | -$13.74 |
| Reversal | All 210 | 119 | 29.41% | **-$135.30** | 0.667 | **-$158.42** |

The 210-market momentum fold results were profitable in two older segments then failed in the third. Aggregate 65% correct predictions returned a slight LOSS, illustrating why hit rate without payout pricing is misleading.

**Verdict: Reject momentum and reversal as independent Kalshi bot trading strategies.** Preserve data for probability-vs-market-price comparisons rather than further threshold mining. No real-money authorization.

## Evidence

Reproducible run and full trade log artifact: https://github.com/pakd33zy-jpg/Momentumfloww/actions/runs/38661814205

Earlier same-rule consecutive 320 contracts, including fee/slippage sensitivity: https://github.com/pakd33zy-jpg/Momentumfloww/blob/research/kalshi-15m-paper-20261014/research/KALSHI_BTC15M_REAL_320_CONTRACT_AUDIT_20261014.md

Neither result proves favorable executable live fills or future profitability. Equity and crypto research remain separate.
