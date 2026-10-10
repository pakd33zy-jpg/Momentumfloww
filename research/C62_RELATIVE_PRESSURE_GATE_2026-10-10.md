# C62 4h relative-pressure gate — 2026-10-10

Research only. Active C62 shadow unchanged.

## Hypothesis
C62 may work when the target alt was already at least as strong as BTC over the prior 4h, then temporarily lags BTC over the current 2h while breaking out. This is a causal pre-entry state.

## 2024-10 -> 2026-10 evidence
The strict relation gate (target 4h return >= BTC 4h return) looked promising across the already-tested windows:
- catastrophic 2024Q4 slice: 1 retained trade, positive
- 2025-01 -> 2025-10 remainder: 7 trades, positive aggregate, PF 1.15
- 2026 Q1: 3 trades, positive aggregate, PF 2.49
- 2026 Q2: 1 trade, positive
- 2026-07-10 -> 2026-08-25 strong slice: 2 trades, both positive
- 2025-10 -> 2026-01 early window: 1 trade, positive
- 2026-08-25 -> 2026-10-10 late window: zero trades (rejected the only baseline loser)

This was only about 15 retained trades, so it was not promoted.

## Earlier independent year: 2023-10-07 -> 2024-10-07
Data provenance:
- BTC/USD: 35,489 15m bars
- ETH/USD: 35,491
- LINK/USD: 35,494
- SOL/USD: only 4,160, therefore SOL is incomplete and must not be used for the verdict.

Baseline available-universe replay:
- 68 trades
- 11 wins / 57 losses
- normalized deployed-capital sum -110.52%
- PF 0.17

Strict target4h >= BTC4h gate:
- 12 trades
- **1 win / 11 losses**
- normalized deployed-capital sum **-31.56%**
- PF **0.01**
- retained trades were 3 ETH and 9 LINK; no SOL was needed for this rejection.

Moderate thresholds also failed:
- relative4h >= -1.0%: 45 trades, -80.35%, PF 0.14
- relative4h >= -0.5%: 21 trades, -49.76%, PF 0.02

## Verdict
**Reject 4h relative pressure as a standalone C62 discriminator.**

The state looked excellent over 2024-10 -> 2026-10 but completely inverted in the earlier independent year on the complete ETH/LINK subset. This is exactly the kind of regime-specific result that must be preserved rather than promoted.

The useful lesson remains: recent winning C62 trades often look like temporary 2h lag inside stronger prior target momentum, but that relationship is not stable enough by itself.

Next research should evaluate all causal pre-entry features across multiple non-overlapping years and only keep features whose relationship to outcome is directionally stable across years.
