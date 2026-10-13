#!/usr/bin/env python3
"""Independent follow-up: same EMA20/EMA200 + MACD entry, different trend exits.

Read-only; uses same Coinbase candles/costs/windows as ema_macd_ablation.py.
Run: python3 momentumflow/research/ema_exit_ablation.py --cache-dir /tmp/ema-macd-research
"""
import argparse
import json
from pathlib import Path
from ema_macd_ablation import (
    ASSETS, SIDE_COST, WINDOWS, fetch_candles, indicators, ts, backtest,
)

EXIT_MODES = ("ema20_breach", "ema20_2_closes", "ema200_breach")

def backtest_exit(rows, ind, start, end, mode, cost=SIDE_COST):
    if mode not in EXIT_MODES: raise ValueError("Unknown exit mode")
    cash = peak = 1.0
    max_dd = 0.0
    entry = None
    trades = 0
    exits = {}
    for i in range(201, len(rows)):
        bar = rows[i]
        if bar[0] < start: continue
        if bar[0] >= end: break
        j = i - 1
        exited = False
        if entry is not None:
            if mode == "ema20_breach":
                trigger = rows[j][4] < ind["ema20"][j]
            elif mode == "ema20_2_closes":
                trigger = (rows[j][4] < ind["ema20"][j]
                           and rows[j-1][4] < ind["ema20"][j-1])
            else:
                trigger = rows[j][4] < ind["ema200"][j]
            if trigger:
                cash *= bar[1] * (1-cost) / entry
                entry = None
                trades += 1
                exited = True
                exits["trend_break"] = exits.get("trend_break", 0) + 1
        if entry is None and not exited:
            crossover = (ind["macd"][j-1] <= ind["signal"][j-1]
                         and ind["macd"][j] > ind["signal"][j])
            entry_qualified = rows[j][4] > ind["ema20"][j] > ind["ema200"][j]
            if crossover and entry_qualified:
                entry = bar[1]*(1+cost)
        equity = cash if entry is None else cash * bar[4]*(1-cost) / entry
        peak = max(peak, equity)
        max_dd = max(max_dd, 1-equity/peak)
    if entry is not None:
        last = next(b for b in reversed(rows) if start <= b[0] < end)
        cash *= last[4]*(1-cost)/entry
        trades += 1
        exits["end_mark"] = 1
    return {
        "return_pct": round(100*(cash-1), 3),
        "max_drawdown_pct": round(100*max_dd, 3),
        "trades": trades,
        "exits": exits,
    }

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--cache-dir", type=Path, default=Path(".cache/ema-macd"))
    args=parser.parse_args()
    report={}
    for symbol in ASSETS:
        bars, digest, from_cache, gaps=fetch_candles(symbol,args.cache_dir)
        ind=indicators(bars)
        summary={}
        for name,start,end in WINDOWS:
            summary[name]={}
            for cost in (0.0025,0.001):
                from ema_macd_ablation import backtest as original
                import ema_macd_ablation as main_module
                old_cost=main_module.SIDE_COST
                main_module.SIDE_COST=cost
                try:
                    baseline=original(bars,ind,ts(start),ts(end),"plus_ema20")
                finally:
                    main_module.SIDE_COST=old_cost
                summary[name][str(cost)]={
                    "unchanged_entry_macd_exit": baseline,
                    **{mode:backtest_exit(bars,ind,ts(start),ts(end),mode,cost)
                       for mode in EXIT_MODES},
                }
        report[symbol]={"source_sha256":digest,"filled_gap_hours":gaps,"windows":summary}
    print(json.dumps({"research_only":True,
                      "change":"exit trigger only; same closed-bar MACD cross + EMA20/EMA200 entry",
                      "cost_per_side":[0.0025,0.001],
                      "results":report}, indent=2))

if __name__=="__main__":main()
