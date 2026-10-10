# C62 asset-persistence gate test — 2026-10-10

Research only. Active C62 shadow remains unchanged.

## Question
Does requiring the target altcoin to already have measurable short-horizon persistence before the existing C62 BTC-led 2h lag trigger separate healthy lag from simple weakness?

The C62 entry/exit logic was otherwise frozen:
- ETH/USD, SOL/USD, LINK/USD targets; BTC/USD leader.
- Closed 15m bars.
- Existing C62 signal rules unchanged.
- Next-15m-open research entry.
- Existing C62 staged/target/trailing exit.
- 1.0% modeled round-trip friction.

## Discovery windows

### Catastrophic slice: 2024-10-10 -> 2025-01-10
Fingerprint reproduced exactly:
- 32 trades
- 4 wins / 28 losses
- PF 0.10
- normalized deployed-capital sum: -81.36%

### Strong slice: 2026-07-10 -> 2026-08-25
Fingerprint reproduced:
- 9 trades
- 7 wins / 2 losses
- PF 3.43
- normalized deployed-capital sum: +12.58%

The strongest pre-entry separator was target-asset 4h momentum. Mean target 4h move:
- bad slice: +0.76%
- strong slice: +2.39%

Outcome grouping across both slices:
- losing trades mean target 4h move: +0.59%
- winning trades mean target 4h move: +2.57%

## Single-gate neighborhood

| Gate | Bad trades | Bad sum | Bad PF | Strong trades | Strong sum | Strong PF |
|---|---:|---:|---:|---:|---:|---:|
| none | 32 | -81.36% | 0.10 | 9 | +12.58% | 3.43 |
| target 4h >= +0.5% | 15 | -38.20% | 0.13 | 8 | +15.55% | 8.04 |
| target 4h >= +1.0% | 12 | -29.19% | 0.16 | 7 | +10.56% | 5.78 |
| target 4h >= +1.5% | 7 | -13.45% | 0.30 | 6 | +6.67% | 4.02 |
| target 4h >= +2.0% | 6 | -11.30% | 0.33 | 4 | +8.45% | no losses |

This is not a one-threshold spike: increasing persistence consistently removes a large fraction of the catastrophic signals, but it also reduces frequency and never makes the bad discovery slice profitable.

## Untouched holdout 1: 2026-01-10 -> 2026-04-10
Baseline: 13 trades, -8.20%, PF 0.54.

- target 4h >= +0.5%: 5 trades, -5.03%, PF 0.29
- target 4h >= +1.0%: 2 trades, -1.09%, PF 0.58
- target 4h >= +1.5%: 1 trade, +1.48%

## Untouched holdout 2: 2026-04-10 -> 2026-07-10
Baseline: 6 trades, +2.07%, PF 1.37.

- target 4h >= +0.5%: 5 trades, +2.50%, PF 1.49
- target 4h >= +1.0%: 4 trades, +4.78%, PF 2.67
- target 4h >= +1.5%: 3 trades, +2.78%, PF 1.97

## Untouched older-year remainder: 2025-01-10 -> 2025-10-07
Fingerprint: 28 trades, which joins the 32-trade catastrophic slice to approximately reproduce the known 60-trade prior-year total.

Baseline:
- 28 trades
- 10 wins
- -25.19%
- PF 0.50

Persistence gates:
- target 4h >= +0.5%: 18 trades, -13.71%, PF 0.58
- target 4h >= +1.0%: 10 trades, -6.06%, PF 0.70
- target 4h >= +1.5%: 7 trades, -4.24%, PF 0.73
- target 4h >= +2.0%: 4 trades, -8.22%, PF 0.46

## Verdict
**Useful component, rejected as a standalone fix.**

Target-asset 4h persistence materially reduces bad C62 exposure in both discovery and untouched holdouts, and preserves/improves the positive Q2 2026 window. But no reasonable single threshold turns the older independent year profitable.

Preserve this result as evidence that "healthy lag" requires some pre-existing target momentum. Do not promote it as an entry gate yet.

Next research should test another causal relationship feature independently—especially BTC impulse persistence or BTC/target relative-pressure state—then evaluate whether it adds information beyond target 4h persistence without parameter stacking.
