const DAY = 86_400_000;

export function ema(values, length) {
  if (!values.length) return [];
  const alpha = 2 / (length + 1);
  let value = values[0];
  return values.map((next) => (value += alpha * (next - value)));
}

export function buildPersistentBreakoutTrades(input, {
  entryDays = 55,
  exitDays = 20,
  emaDays = 200,
  slopeDays = 20,
  atrDays = 20,
  stopAtr = 3,
  exclusiveEnd = Infinity,
} = {}) {
  const bars = input
    .map((b) => ({ t: +b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +(b.v ?? 0) }))
    .filter((b) => b.t < exclusiveEnd)
    .sort((a, b) => a.t - b.t);
  const trend = ema(bars.map((b) => b.c), emaDays);
  const trades = [];
  let position = null;
  let pending = null;

  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i];
    const contiguous = bar.t - bars[i - 1].t === DAY;
    if (!contiguous) pending = null;

    if (pending) {
      const risk = stopAtr * pending.atr;
      if (risk > 0 && risk < bar.o) {
        position = { at: bar.t, entry: bar.o, risk, stop: bar.o - risk };
      }
      pending = null;
    }

    if (position) {
      if (contiguous && i >= exitDays && bars[i - 1].t - bars[i - exitDays].t === (exitDays - 1) * DAY) {
        position.stop = Math.max(position.stop, ...[Math.min(...bars.slice(i - exitDays, i).map((b) => b.l))]);
      }
      if (bar.l <= position.stop) {
        const exit = Math.min(bar.o, position.stop);
        trades.push({ ...position, exitAt: bar.t, exit, rawPct: (exit / position.entry - 1) * 100 });
        position = null;
      }
    }

    const warmup = Math.max(emaDays + slopeDays, entryDays, atrDays) + 1;
    if (position || !contiguous || i < warmup || bars[i - 1].t - bars[i - warmup].t !== (warmup - 1) * DAY) continue;
    let atr = 0;
    for (let k = i - atrDays + 1; k <= i; k++) {
      atr += Math.max(bars[k].h - bars[k].l, Math.abs(bars[k].h - bars[k - 1].c), Math.abs(bars[k].l - bars[k - 1].c));
    }
    atr /= atrDays;
    const priorHigh = Math.max(...bars.slice(i - entryDays, i).map((b) => b.h));
    if (bar.c > priorHigh && bar.c > trend[i] && trend[i] > trend[i - slopeDays]) pending = { atr };
  }
  return { bars, trades, open: position, pending };
}

export function tradeStats(trades, roundTripCostPct = 1) {
  let grossWins = 0;
  let grossLosses = 0;
  for (const trade of trades) {
    const net = trade.rawPct - roundTripCostPct;
    if (net > 0) grossWins += net;
    else grossLosses -= net;
  }
  return {
    closedTrades: trades.length,
    netReturnPoints: grossWins - grossLosses,
    profitFactor: grossLosses ? grossWins / grossLosses : null,
  };
}
