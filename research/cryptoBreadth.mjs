import { ema } from './causalCryptoEngine.mjs';

const normalize = (bars) => bars
  .map((b) => ({ t: +b.t, c: +b.c }))
  .filter((b) => Number.isFinite(b.t) && Number.isFinite(b.c) && b.c > 0)
  .sort((a, b) => a.t - b.t);

export function buildCryptoBreadth(series, emaDays = 100) {
  const prepared = Object.fromEntries(Object.entries(series).map(([symbol, input]) => {
    const bars = normalize(input);
    const trend = ema(bars.map((b) => b.c), emaDays);
    return [symbol, { bars, trend, byTime: new Map(bars.map((b, i) => [b.t, i])) }];
  }));
  const times = [...new Set(Object.values(prepared).flatMap((x) => x.bars.map((b) => b.t)))].sort((a, b) => a - b);
  return new Map(times.map((t) => {
    let eligible = 0;
    let above = 0;
    for (const item of Object.values(prepared)) {
      const i = item.byTime.get(t);
      if (i == null || i < emaDays - 1) continue;
      eligible++;
      if (item.bars[i].c > item.trend[i]) above++;
    }
    return [t, { eligible, above, fraction: eligible ? above / eligible : 0 }];
  }));
}

export function relativeStrengthRanks(series, t, lookbackDays = 90, benchmark = 'BTC/USD') {
  const prepared = Object.fromEntries(Object.entries(series).map(([symbol, input]) => {
    const bars = normalize(input).filter((b) => b.t <= t);
    return [symbol, bars];
  }));
  const benchmarkBars = prepared[benchmark] || [];
  if (benchmarkBars.length <= lookbackDays) return [];
  const benchmarkReturn = benchmarkBars.at(-1).c / benchmarkBars.at(-(lookbackDays + 1)).c - 1;
  return Object.entries(prepared)
    .filter(([symbol, bars]) => symbol !== benchmark && bars.length > lookbackDays)
    .map(([symbol, bars]) => ({
      symbol,
      excessReturn: bars.at(-1).c / bars.at(-(lookbackDays + 1)).c - 1 - benchmarkReturn,
    }))
    .sort((a, b) => b.excessReturn - a.excessReturn || a.symbol.localeCompare(b.symbol));
}

export function breadthExpansionGate(breadth, t, priorT, minimumFraction = 0.60) {
  const now = breadth.get(t);
  const prior = breadth.get(priorT);
  return Boolean(now && prior && now.eligible > 0 && now.fraction >= minimumFraction && now.fraction > prior.fraction);
}
