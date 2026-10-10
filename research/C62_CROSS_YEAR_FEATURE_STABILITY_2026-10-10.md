# C62 cross-year pre-entry feature stability study — 2026-10-10

Research only. Active C62 shadow unchanged.

## Goal
Stop hand-picking one threshold from one good/bad slice. Evaluate the same causal pre-entry features across three non-overlapping years using the same ETH/LINK universe so incomplete older SOL history cannot distort the comparison.

Windows:
1. 2023-10-07 -> 2024-10-07
2. 2024-10-07 -> 2025-10-07
3. 2025-10-10 -> 2026-10-10

Execution model remained the frozen research C62 model:
- BTC leader; ETH/LINK targets in this apples-to-apples study.
- Existing C62 entry unchanged.
- Next-15m-open research entry.
- Existing staged/target/trailing C62 exit.
- 1.0% modeled round-trip friction.

## Baselines
- Year 1: 66 trades, 11 wins, -105.71% normalized deployed-capital sum, PF 0.18.
- Year 2: 34 trades, 7 wins, -66.20%, PF 0.17.
- Year 3: 20 trades, 10 wins, +3.48%, PF 1.19.

## Major finding: many intuitive features flip sign
Examples of winner-vs-loser standardized effects:
- BTC 2h impulse: +0.51, -0.86, +0.96.
- BTC 2h directional efficiency: +0.48, -0.92, +1.21.
- Target 2h move: +0.55, -0.74, +0.96.
- Target 2h efficiency: +0.48, -0.70, +0.93.
- Target 8h momentum: +0.29, -0.39, +1.12.

These are not stable standalone discriminators. The middle year in particular reverses several relationships seen in the years on either side.

## Features with stable direction across all three years
A few features did retain the same *direction*:
- target prior-2h momentum: positive association with winners in all three years.
- target acceleration (current 2h minus prior 2h): negative association in all three years.
- target-vs-BTC 4h relative pressure: positive association in all three years, although hard thresholding it already failed an earlier independent-year test.
- BTC prior-2h momentum: weak positive association in all three years.

The most interpretable state is:
**the target was already moving in the prior 2h, then decelerated/lagged during the current BTC impulse rather than suddenly accelerating from weakness.**

## No-parameter deceleration test
Rule: target prior-2h move > target current-2h move.

Year 1:
- baseline 66 trades, -105.71%, PF 0.18
- deceleration only 33 trades, -50.49%, PF 0.22

Year 2:
- baseline 34 trades, -66.20%, PF 0.17
- deceleration only 15 trades, -23.95%, PF 0.27

Year 3:
- baseline 20 trades, +3.48%, PF 1.19
- deceleration only 10 trades, -2.79%, PF 0.72

## Verdict
**Preserve the deceleration/prior-momentum state as a useful risk-quality feature, but reject it as a hard C62 fix.**

It materially reduces damage in the two older losing years, but it also removes enough profitable recent trades to turn the latest year negative. The broader conclusion is more important: C62's local entry feature relationships are regime-dependent and cannot be made robust by another simple binary gate.

Do not keep parameter-mining C62 entry thresholds.

Next direction:
- treat C62 as a regime-dependent component, not the sole crypto strategy;
- recover and reconcile the original C60/C62 historical audit provenance (+27% to +32% fingerprints) instead of assuming the current recovered source reproduces it;
- search preserved prior strategy families for independent edges that can form separate sleeves rather than stacking more gates onto C62.
