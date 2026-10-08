# C62 x V31 BTC Regime Research — Data-Provenance Blocked

_Date: 2026-10-08_

## Purpose

Test source-recovered V31 broad-regime hard brakes around the **frozen C62 entry/exit**, one at a time, without changing the active C62 shadow.

## Source-recovered V31 predicates

Recovered from `pakd33zy-jpg/AdaptiveConfluenceLab/scripts/research_equity_rotation_v31.py`.

Only hard-cash predicates that map directly to BTC were ported. The equity breadth-dependent sizing layer was **not** translated into a made-up crypto breadth proxy.

- **trend_cash_hard:** block when prior completed BTC daily close < SMA200 **and** 126-day momentum < 0.
- **fast_brake_hard:** block when (close < SMA200 and 63-day momentum < 0) **or** 63-day momentum < -6% **or** (20-day annualized realized volatility > 30% and 63-day momentum < 0).
- **two_stage_hard:** block only when the V31 broken-trend state and shock state are both true.
- Realized volatility: sample standard deviation of 20 prior completed daily log returns × sqrt(252) × 100.

## Provenance gate

The older window had to reproduce approximately the known **60-trade** C62 baseline before any filtered result could be accepted.

Known older fingerprints include:
- 60 trades, about -44.49%, PF about 0.38.
- consistent direct-Alpaca replay: 60 trades, -44.37%, PF 0.384.

## What happened

The Render research replay failed the provenance gate.

Returned historical bar counts:
- BTC/USD: 35,214
- ETH/USD: 13,990
- SOL/USD: **577**
- LINK/USD: **577**

The frozen baseline therefore produced only **6 accepted trades**, all ETH, instead of approximately 60 trades across ETH/SOL/LINK.

The runner automatically stopped after the older window and **did not run the recent-year comparison**.

A filtered result from this incomplete sample appeared superficially better, but it is **invalid and must not be used as strategy evidence**.

## Verdict

**NO V31 STRATEGY VERDICT. DATA PROVENANCE FAILED.**

Do not classify V31 as passed or failed from this replay.

Next valid V31 attempt must use a source that reproduces the known C62 trade-count fingerprint before comparing regime filters.

## Infrastructure finding kept separate from strategy evidence

During this work, Render logs exposed Alpaca market-data 429 collisions between active paper/shadow processes.

Operational fixes were made without changing strategy rules:
- shared market-data request pacing/retry in `alpacaClient.js`,
- 55/20 and validation50 daily-bar requests routed through that shared client,
- original `adjustment=all` behavior preserved.

After the final combined deployment, the checked startup window showed no new 55/20, validation50, or C62 429/ReferenceError logs.

This is an **execution/data reliability improvement**, not evidence that any strategy has higher expectancy.
