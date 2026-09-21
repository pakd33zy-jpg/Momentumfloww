# MomentumFlow recovered research checkpoint

Recovered after automatic workspace pruning on 2026-09-15. This ledger prevents repetition of completed and rejected work. PAPER/shadow only; no winner or live authorization.

## Execution corrections that must remain

- Signals use completed candles only and enter at the next contiguous open.
- Entry-bar stops are evaluated. Adverse gaps fill at the opening price. Stop wins same-bar stop/target ambiguity.
- Crypto trailing floors use prior completed bars, never the current bar.
- Exclusive test boundaries are enforced before indicator calculation.
- Equity MACD crossover only arms a setup; EMA20 confirmation must occur on a strictly later completed candle.
- Shared-capital accounting retains idle cash, actual entry/exit notional fees, deterministic same-time allocation, and explicit risk/exposure caps.

## Crypto evidence

- Corrected persistent breakout core: 55-day breakout, rising EMA200, next open, 3 ATR initial stop, prior-20-day low trail.
- Corrected shared-capital replay on the original major-coin universe: 66 closed trades, approximately +12.95%, PF 1.83, 7.11% daily-close drawdown at 1% modeled round-trip cost.
- Result is not a winner: removing SOL and XRP together changed return to approximately -1.78%, PF 0.88. Gains remain concentrated.
- Breakout-strength gate (0.5–1.5 ATR) was rejected: on new eligible symbols it produced one losing trade; baseline produced five losses.
- Causal top-half trailing liquidity rank improved the development headline to 50 trades and PF 2.20 at 1% cost, but removing the two best trades made net negative; 2025 PF was about 0.52. Keep liquidity ranking as a tradability control, not predictive edge.
- Daily EMA200/EMA20 pullback and anti-chase branches failed broader historical validation. Do not retry unchanged.
- BTC-regime plus altcoin relative-strength breakout was rejected. The predeclared 55-day breakout / 90-day relative-strength / top-three version had 30 training trades and PF 2.09, but untouched 2025-2026 produced 11 trades, -83.40 return-points and PF 0.43.
- Adding a predeclared expanding-market-breadth gate (at least 60% of the eleven-coin universe above EMA100 and breadth higher than 20 days earlier) improved untouched results to six trades, +8.94 return-points and PF 1.16. This is not validated: removing the two best trades eliminates all profit. Preserve as a candidate component, not a winner.
- Daily breadth plus 4-hour trend breakout was rejected across 27 nearby settings and nine coins with usable 4-hour histories. The predeclared 40-bar breakout / 2 ATR stop / 10-bar trail produced 129 training trades at PF 0.55 and 57 untouched trades at PF 0.59 (-87.00 return-points). Long trails created attractive training headlines but every such setting failed untouched data, confirming regime/parameter instability.
- Strong-regime 4-hour statistical pullback/recovery was also rejected across 27 settings. The predeclared two-standard-deviation pullback / 2 ATR stop / 12-bar maximum hold produced 210 training trades at PF 0.54 and 93 untouched trades at PF 0.31 (-204.49 return-points). All tested neighboring settings lost in both periods. Do not retry either 4-hour entry family unchanged.
- Breadth-gated cross-sectional crypto rotation was tested across 48 expanding-breadth settings and 81 persistent-breadth settings. The expanding-breadth 90-day / seven-day hold / top-two core was positive in both periods (training PF 1.96, untouched PF 1.63), but untouched data contained only eight trades and removing the best two reduced PF to 0.17. Replacing expansion with a persistent breadth threshold increased the predeclared sample to 71 training and 26 untouched trades, but untouched PF fell to 0.82 with -28.54% compounded return. No persistent-breadth neighbor passed both periods plus best-two removal. Reject the rotation family as unvalidated and winner-dependent.

- Loosened crypto strategy gates were exhaustively tested without weakening causal/accounting integrity. Across 900 broader regime/rotation combinations and 432 structured-stop variants, none passed training, untouched data, drawdown, and best-two-trade removal together. The most attractive loosened branch remained winner-concentrated and suffered excessive training drawdown. Do not loosen execution integrity to manufacture a pass.

## Equity evidence

- Strict EMA200 + confirmed structure + MACD arm + later EMA20 confirmation + pullback stop + exact 2R produced only seven stored-window trades after correcting the same-candle defect.
- Corrected twelve-stock stored-window portfolio: approximately +0.43%, PF 1.52 at 0.05% cost.
- Stored period checks: 2023 H2 had two losses; 2024 H2 had five trades and PF 1.61; 2025 results were session-treatment-sensitive; 2026 stored window had seven trades and PF 1.52.
- Twelve new symbols in 2025 produced only four trades across the full year. Positive, but operationally and statistically inadequate. Preserve sequencing/risk lessons; reject this exact entry stack as deployable.
- Rebuilt score-based daily equity engine tested 243 predeclared combinations across SPY, QQQ, IWM, DIA, XLK, XLF, XLE, GLD, TLT, AAPL, MSFT, and NVDA using Alpaca IEX bars. Parameters were ranked only on 2021-2024, then checked on untouched 2025-2026 data.
- The strongest training selection (score 5, 55-day structure, 2 ATR stop, 3R target, 40-bar timeout) had 154 training trades, +147.45 return-points and PF 1.40, but its untouched test produced 90 trades, -64.82 points and PF 0.75. Other top training selections also failed out of sample (PF approximately 0.66-0.87). Reject this simple trend/breakout score family unchanged.
- Regime-aware ETF rotation was also unstable. The predeclared 63-day momentum / five-day rebalance / top-two version lost 10.28% in training (PF 0.95) and 14.06% in untouched data (PF 0.92). Nearby settings ranged from large gains to large losses, so isolated positive settings were rejected as parameter sensitivity.

- Fifteen-minute opening-gap fade and opening-gap continuation were each tested across 144 configurations on twelve liquid equities/ETFs, using next-bar entry, same-day exit, 0.06% modeled cost, and a separate 2025 download. Both families were negative in training and 2025; best training PF was below 1.0. Reject both gap-direction families unchanged.

- Fifteen-minute opening-range breakout and rejected-breakout reversal were each tested across 144 configurations on the same twelve-symbol training/2025 split. Both produced thousands of trades but remained below break-even before and after the split (best training PF 0.96 for breakout and 0.74 for rejection reversal). Reject both opening-range families unchanged.

- Intraday cross-sectional relative-strength continuation and reversal were each tested across 108 synchronized market-neutral configurations; neither reached break-even in both training and 2025. VWAP-deviation mean reversion was then tested across 192 late-session and 384 corrected early-session configurations with closed-candle signals, next-bar execution, stops, same-day exits, and costs. No configuration passed; even the strongest training PF remained below 0.80. Reject these intraday relative-strength and VWAP families unchanged.

## Next research direction

1. Rebuild invariant-tested causal engines.
2. Crypto: retain trend persistence and liquidity eligibility; replace the non-generalizing breakout-strength filter with a predeclared regime/relative-strength hypothesis, then validate on untouched symbols/time.
3. Equity: retain later-candle confirmation and structured risk, but reduce gate stacking using scoring; validate chronologically with realistic costs and a materially larger trade count.
4. Push every completed code/result checkpoint to this remote branch immediately.
