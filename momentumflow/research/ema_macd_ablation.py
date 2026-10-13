#!/usr/bin/env python3
"""Research-only, causal EMA/MACD ablation using public Coinbase Exchange candles.

No account credentials, AlphaInsider order submission, or MomentumFlow bot changes.
Run: python3 momentumflow/research/ema_macd_ablation.py --cache-dir /tmp/ema-research
Data: Coinbase Exchange BTC-USD & ETH-USD completed 1h OHLCV, UTC.
Methods: four sequential hypotheses; NO tuning based on holdout outcomes.
"""
import argparse
import hashlib
import json
import math
import pathlib
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ASSETS = ("BTC-USD", "ETH-USD")
ONE_HOUR = 3600
DATA_START = "2024-10-01T00:00:00Z"
DATA_END = "2026-10-13T00:00:00Z"  # exclusive
WINDOWS = (
    ("older", "2025-03-10T00:00:00Z", "2025-10-13T00:00:00Z"),
    ("newer_holdout", "2025-10-13T00:00:00Z", DATA_END),
)
# 0.25% per side = 0.50% total including assumed fees and slippage.
SIDE_COST = 0.0025
VARIANTS = ("macd_cross", "plus_ema200", "plus_ema20", "plus_atr_2r")

def ts(iso):
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())

def fetch_candles(asset, cache_dir):
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / (asset.replace("-", "_") + "_hourly.json")
    if path.exists():
        source = json.loads(path.read_text())
        if source.get("start") == DATA_START and source.get("end") == DATA_END:
            return source["rows"], hashlib.sha256(path.read_bytes()).hexdigest(), True
    begin, end = ts(DATA_START), ts(DATA_END)
    found = {}
    for left in range(begin, end, 250 * ONE_HOUR):
        right = min(end, left + 250 * ONE_HOUR)
        query = urllib.parse.urlencode({
            "granularity": ONE_HOUR,
            "start": datetime.fromtimestamp(left, timezone.utc).isoformat(),
            "end": datetime.fromtimestamp(right, timezone.utc).isoformat()
        })
        url = "https://api.exchange.coinbase.com/products/" + asset + "/candles?" + query
        request = urllib.request.Request(url, headers={
            "User-Agent": "MomentumFlowResearch/1.0",
            "Accept": "application/json",
        })
        for attempt in range(4):
            try:
                with urllib.request.urlopen(request, timeout=18) as response:
                    values = json.load(response)
                if not isinstance(values, list): raise ValueError("Not a candle array")
                break
            except Exception:
                if attempt == 3: raise
                time.sleep((attempt + 1) * 1.5)
        for bar in values:
            if not isinstance(bar, list) or len(bar) < 6: continue
            stamp = int(bar[0])
            if begin <= stamp < end:
                found[stamp] = [stamp, float(bar[3]), float(bar[2]), float(bar[1]), float(bar[4]), float(bar[5])]
        time.sleep(0.11)
    rows = [found[k] for k in sorted(found)]
    expected = (end - begin) // ONE_HOUR
    missing = expected - len(rows)
    # Refuse to backtest incomplete datasets rather than silently shift signal timing.
    if missing != 0 or any(rows[i][0] - rows[i-1][0] != ONE_HOUR for i in range(1, len(rows))):
        raise ValueError(f"Missing {missing} hourly bars for {asset} (expected={expected}, got={len(rows)}).")
    path.write_text(json.dumps({"start": DATA_START, "end": DATA_END, "asset": asset, "rows": rows},
                               separators=(",", ":")))
    return rows, hashlib.sha256(path.read_bytes()).hexdigest(), False

def ema(values, period):
    result = [None] * len(values)
    if len(values) < period: return result
    result[period-1] = sum(values[:period]) / period
    alpha = 2.0 / (period + 1)
    for i in range(period, len(values)):
        result[i] = values[i] * alpha + result[i-1] * (1 - alpha)
    return result

def indicators(rows):
    c = [r[4] for r in rows]
    a12, a26 = ema(c, 12), ema(c, 26)
    macd = [a-b if a is not None and b is not None else None for a,b in zip(a12,a26)]
    first = next(i for i,v in enumerate(macd) if v is not None)
    signal_partial = ema(macd[first:], 9)
    signal = [None]*first + signal_partial
    atr = [None]*len(rows)
    trs = []
    for i,r in enumerate(rows):
        prev_close = c[i-1] if i else c[i]
        trs.append(max(r[2]-r[3], abs(r[2]-prev_close), abs(r[3]-prev_close)))
    atr[13] = sum(trs[:14])/14
    for i in range(14,len(rows)):
        atr[i] = (atr[i-1]*13+trs[i])/14
    return {"macd": macd,"signal": signal,"ema20": ema(c,20),"ema200": ema(c,200),"atr":atr}

def backtest(rows, ind, start, end, variant):
    cash, position, peak, maxdd = 1.0, None, 1.0, 0.0
    trades, curves = [], []
    for i in range(201, len(rows)):
        r,prev = rows[i],rows[i-1]
        if r[0] < start: continue
        if r[0] >= end: break
        def crossed_up(j):
            return (ind["macd"][j-1] <= ind["signal"][j-1]
                    and ind["macd"][j] > ind["signal"][j])
        def crossed_down(j):
            return (ind["macd"][j-1] >= ind["signal"][j-1]
                    and ind["macd"][j] < ind["signal"][j])
        def close_position(price, reason):
            nonlocal cash, position
            exit_effective = price*(1-SIDE_COST)
            ret = exit_effective/position["entry_effective"] - 1
            cash *= (1 + ret)
            trades.append({
                "entry": position["time"],"exit":r[0],"return":ret,"reason":reason,
                "bars": (r[0]-position["time"])//ONE_HOUR,
            })
            position = None
        if position is not None and crossed_down(i-1):
            close_position(r[1],"macd_exit_next_open")
        elif position is not None and variant == "plus_atr_2r":
            stop, target = position["stop"], position["target"]
            # Gap fills use the open, intrabar fills use the stop/target.
            if r[1] <= stop:
                close_position(r[1],"gap_stop")
            elif r[1] >= target:
                close_position(r[1],"gap_target")
            elif r[3] <= stop:
                close_position(stop, "stop_wins_double_touch")
            elif r[2] >= target:
                close_position(target,"target")
        # No same-bar reentry after an exit; all signals use the last closed candle.
        if position is None and not (trades and trades[-1]["exit"] == r[0]):
            if crossed_up(i-1):
                allowed = True
                if variant in ("plus_ema200","plus_ema20","plus_atr_2r"):
                    allowed = prev[4] > ind["ema200"][i-1]
                if variant in ("plus_ema20","plus_atr_2r"):
                    allowed = allowed and prev[4] > ind["ema20"][i-1] > ind["ema200"][i-1]
                if allowed:
                    effective = r[1]*(1+SIDE_COST)
                    position = {"entry_effective": effective, "time":r[0]}
                    if variant == "plus_atr_2r":
                        stop_dist = 2*ind["atr"][i-1]
                        position.update({"stop": r[1]-stop_dist,"target":r[1]+2*stop_dist})
                        if position["stop"] <= 0: position = None
                    # Conservative: stop/target may occur on entry bar after its open.
                    if position is not None and variant == "plus_atr_2r":
                        if r[3] <= position["stop"]: close_position(position["stop"],"entry_bar_stop")
                        elif r[2] >= position["target"]: close_position(position["target"],"entry_bar_target")
        mtm = cash if position is None else cash * (r[4]*(1-SIDE_COST)/position["entry_effective"])
        peak = max(peak,mtm)
        maxdd = max(maxdd, 1-mtm/peak)
        curves.append([r[0],round(mtm,8)])
    if position is not None:
        r = next((r for r in reversed(rows) if start<=r[0]<end),None)
        if r is not None:
            effective = r[4]*(1-SIDE_COST)
            ret = effective/position["entry_effective"]-1
            cash *= (1+ret)
            trades.append({"entry":position["time"],"exit":r[0],"return":ret,"reason":"end_mark_liquidation",
                           "bars":(r[0]-position["time"])//ONE_HOUR})
    wins = [t["return"] for t in trades if t["return"] > 0]
    losses = [-t["return"] for t in trades if t["return"] < 0]
    return {
        "return_pct":round(100*(cash-1),3),
        "max_drawdown_pct":round(100*maxdd,3),
        "trades":len(trades),
        "win_rate_pct":round(100*len(wins)/len(trades),2) if trades else 0,
        "profit_factor":round(sum(wins)/sum(losses),3) if losses else (None if not wins else None),
        "exit_reasons":{reason:sum(t["reason"]==reason for t in trades) for reason in sorted(set(t["reason"] for t in trades))}
    }

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--cache-dir",type=pathlib.Path,default=pathlib.Path(".cache/ema-macd"))
    parser.add_argument("--symbol",choices=ASSETS,default=None,help="Download and evaluate one coin")
    args=parser.parse_args()
    all_results={}
    for symbol in (args.symbol,) if args.symbol else ASSETS:
        rows,digest,from_cache=fetch_candles(symbol,args.cache_dir)
        state=indicators(rows)
        windows={}
        for name,start,end in WINDOWS:
            windows[name]={v:backtest(rows,state,ts(start),ts(end),v) for v in VARIANTS}
        all_results[symbol]={"candles":len(rows),"dataset_sha256":digest,
                             "cached":from_cache,"windows":windows}
    print(json.dumps({"research_only":True,"source":"Coinbase Exchange public hourly candles",
        "period":[DATA_START,DATA_END],"cost_per_side":SIDE_COST,
        "trade_model":"long-only, full notional, next-hour open, no live orders",
        "signal":"MACD12/26/9 cross on closed 1h candle; additive EMA200, EMA20, then ATR14 stop 2x / target 4x",
        "windows":WINDOWS,"results":all_results},indent=2))

if __name__ == "__main__":
    main()
