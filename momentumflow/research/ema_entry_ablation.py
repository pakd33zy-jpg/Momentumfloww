#!/usr/bin/env python3
"""Exploratory entry-filter ablation for MACD/EMA hourly strategy.

Standalone read-only research. Changes ONE entry constraint at a time.
Reuses Coinbase candle caching and EMA/MACD indicators from ema_macd_ablation.py.
The newer evaluation window was already seen in earlier studies: it is NOT
a pristine holdout. No trading code is imported or modified.
"""
import argparse
import json
from pathlib import Path

from ema_macd_ablation import ASSETS, SIDE_COST, fetch_candles, indicators, ts

EXTRA_ENTRY_FILTERS = (
    "baseline",
    "macd_positive",
    "ema200_rising_48h",
    "momentum_24h_over_1pct",
    "breakout_prior_24h",
    "volume_over_1p5x_prior_24h",
)
WINDOWS = (
    ("early_2024_25", "2024-11-01T00:00:00Z", "2025-03-10T00:00:00Z"),
    ("older_2025", "2025-03-10T00:00:00Z", "2025-10-13T00:00:00Z"),
    ("newer_2025_26", "2025-10-13T00:00:00Z", "2026-10-13T00:00:00Z"),
)


def entry_passes(rows, indicators_at, i, rule, cumulative_volume):
    """Bar i has CLOSED before execution at next bar's open."""
    close = rows[i][4]
    if rule == "baseline": return True
    if rule == "macd_positive": return indicators_at["macd"][i] > 0
    if rule == "ema200_rising_48h":
        return indicators_at["ema200"][i] > indicators_at["ema200"][i - 48]
    if rule == "momentum_24h_over_1pct":
        return close / rows[i - 24][4] - 1 > 0.01
    if rule == "breakout_prior_24h":
        return close > max(bar[2] for bar in rows[i - 24:i])
    if rule == "volume_over_1p5x_prior_24h":
        avg_volume = (cumulative_volume[i] - cumulative_volume[i-24]) / 24
        return avg_volume > 0 and rows[i][5] >= 1.5 * avg_volume
    raise ValueError("Unsupported entry filter")


def test_entry_filter(rows, indicator, start, end, extra="baseline", side_cost=SIDE_COST):
    """Long/cash full-notional proxy. Previous CLOSED hour => next-open action."""
    if extra not in EXTRA_ENTRY_FILTERS:
        raise ValueError("Unsupported entry filter")
    cash = 1.0
    peak = 1.0
    max_dd = 0.0
    position = None
    trades = []
    entries = []
    cumulative_volume = [0.0]
    for row in rows:
        cumulative_volume.append(cumulative_volume[-1] + row[5])

    for i in range(201, len(rows)):
        bar = rows[i]
        signal = i - 1
        if bar[0] < start: continue
        if bar[0] >= end: break

        just_exited = False
        if position is not None and rows[signal][4] < indicator["ema200"][signal]:
            net = bar[1] * (1 - side_cost) / position["price"] - 1
            cash *= (1 + net)
            trades.append({"entry_at": position["time"], "exit_at": bar[0], "net_return": net})
            position = None
            just_exited = True

        if position is None and not just_exited:
            cross_up = (
                indicator["macd"][signal-1] <= indicator["signal"][signal-1]
                and indicator["macd"][signal] > indicator["signal"][signal]
            )
            trend = (
                rows[signal][4] > indicator["ema20"][signal] > indicator["ema200"][signal]
            )
            if cross_up and trend and entry_passes(rows, indicator, signal, extra, cumulative_volume):
                position = {"price": bar[1] * (1 + side_cost), "time": bar[0]}
                entries.append(bar[0])

        equity = cash if position is None else cash * (bar[4] * (1 - side_cost)) / position["price"]
        peak = max(peak, equity)
        max_dd = max(max_dd, 1-equity/peak)

    if position is not None:
        last = next(bar for bar in reversed(rows) if start <= bar[0] < end)
        net = last[4] * (1 - side_cost) / position["price"] - 1
        cash *= (1 + net)
        trades.append({"entry_at": position["time"], "exit_at": last[0], "net_return": net})

    wins = [t["net_return"] for t in trades if t["net_return"] > 0]
    losses = [-t["net_return"] for t in trades if t["net_return"] < 0]
    return {
        "return_pct": round((cash - 1) * 100, 3),
        "max_drawdown_pct": round(max_dd * 100, 3),
        "round_trips": len(trades),
        "profit_factor": round(sum(wins) / sum(losses), 3) if losses else None,
        "last_30d_entries": sum(1 for stamp in entries if stamp >= end - 30*86400),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", type=Path, default=Path(".cache/ema-macd"))
    args = parser.parse_args()
    results = {}
    for symbol in (*ASSETS, "SOL-USD"):
        bars, digest, cached, gap_count = fetch_candles(symbol, args.cache_dir)
        indicator = indicators(bars)
        window_results = {}
        for name, start, end in WINDOWS:
            window_results[name] = {
                rule: test_entry_filter(bars, indicator, ts(start), ts(end), rule)
                for rule in EXTRA_ENTRY_FILTERS
            }
        results[symbol] = {
            "candles": len(bars),
            "source_dataset_sha256": digest,
            "causally_filled_missing_hourly_candles": gap_count,
            "windows": window_results,
        }
    print(json.dumps({
        "research_only": True,
        "validation_status": "EXPLORATORY; newer period previously inspected, no fresh holdout",
        "side_cost": SIDE_COST,
        "entry": "closed 1h MACD cross with close > EMA20 > EMA200; one extra filter per variant",
        "exit": "next hourly open after close falls below EMA200; open final position marked at window end",
        "windows": WINDOWS,
        "results": results,
    }, indent=2))


if __name__ == "__main__": main()
