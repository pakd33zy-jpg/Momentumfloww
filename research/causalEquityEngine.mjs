const DAY = 86_400_000;

export function ema(values, length) {
  if (!values.length) return [];
  const alpha = 2 / (length + 1);
  let value = values[0];
  return values.map((next) => (value += alpha * (next - value)));
}

export function atr(bars, length = 14) {
  const output = Array(bars.length).fill(null);
  let rolling = 0;
  const ranges = bars.map((bar, i) => i === 0 ? bar.h - bar.l : Math.max(
    bar.h - bar.l,
    Math.abs(bar.h - bars[i - 1].c),
    Math.abs(bar.l - bars[i - 1].c),
  ));
  for (let i = 0; i < bars.length; i++) {
    rolling += ranges[i];
    if (i >= length) rolling -= ranges[i - length];
    if (i >= length - 1) output[i] = rolling / length;
  }
  return output;
}

const normalize = (input, exclusiveEnd) => input
  .map((b) => ({ t: +b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +(b.v ?? 0) }))
  .filter((b) => b.t < exclusiveEnd && [b.t, b.o, b.h, b.l, b.c].every(Number.isFinite))
  .sort((a, b) => a.t - b.t);

export function buildScoredEquityTrades(input, {
  fastEma = 20,
  slowEma = 200,
  slopeBars = 20,
  atrBars = 14,
  structureBars = 20,
  volumeBars = 20,
  minimumScore = 4,
  stopAtr = 1.5,
  rewardRisk = 2,
  maxHoldBars = 20,
  allowShort = true,
  exclusiveEnd = Infinity,
} = {}) {
  const bars = normalize(input, exclusiveEnd);
  const fast = ema(bars.map((b) => b.c), fastEma);
  const slow = ema(bars.map((b) => b.c), slowEma);
  const ranges = atr(bars, atrBars);
  const trades = [];
  let pending = null;
  let position = null;

  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i];
    const contiguous = bar.t - bars[i - 1].t <= 4 * DAY;
    if (!contiguous) pending = null;

    if (pending) {
      const risk = pending.risk;
      if (risk > 0 && risk < bar.o) {
        const stop = bar.o - pending.direction * risk;
        const target = bar.o + pending.direction * rewardRisk * risk;
        position = { at: bar.t, entry: bar.o, direction: pending.direction, score: pending.score, risk, stop, target, barsHeld: 0 };
      }
      pending = null;
    }

    if (position) {
      position.barsHeld++;
      const long = position.direction === 1;
      const stopHit = long ? bar.l <= position.stop : bar.h >= position.stop;
      const targetHit = long ? bar.h >= position.target : bar.l <= position.target;
      let exit = null;
      let reason = null;
      if (stopHit) {
        exit = long ? Math.min(bar.o, position.stop) : Math.max(bar.o, position.stop);
        reason = 'STOP';
      } else if (targetHit) {
        exit = position.target;
        reason = 'TARGET';
      } else if (position.barsHeld >= maxHoldBars) {
        exit = bar.c;
        reason = 'TIME';
      }
      if (exit != null) {
        trades.push({ ...position, exitAt: bar.t, exit, reason, rawPct: position.direction * (exit / position.entry - 1) * 100 });
        position = null;
      }
    }

    const warmup = Math.max(slowEma + slopeBars, structureBars, volumeBars, atrBars) + 1;
    if (position || !contiguous || i < warmup || ranges[i] == null) continue;
    const prior = bars.slice(i - structureBars, i);
    const avgVolume = bars.slice(i - volumeBars, i).reduce((sum, b) => sum + b.v, 0) / volumeBars;
    const longScore = Number(bar.c > slow[i]) + Number(slow[i] > slow[i - slopeBars]) +
      Number(bar.c > fast[i]) + Number(bar.c > Math.max(...prior.map((b) => b.h))) + Number(bar.v > avgVolume);
    const shortScore = Number(bar.c < slow[i]) + Number(slow[i] < slow[i - slopeBars]) +
      Number(bar.c < fast[i]) + Number(bar.c < Math.min(...prior.map((b) => b.l))) + Number(bar.v > avgVolume);
    const direction = longScore >= minimumScore && longScore > shortScore ? 1
      : allowShort && shortScore >= minimumScore && shortScore > longScore ? -1 : 0;
    if (direction) pending = { direction, score: direction === 1 ? longScore : shortScore, risk: stopAtr * ranges[i] };
  }

  return { bars, trades, open: position, pending };
}

export function tradeStats(trades, roundTripCostPct = 0.10) {
  let wins = 0;
  let losses = 0;
  for (const trade of trades) {
    const net = trade.rawPct - roundTripCostPct;
    if (net > 0) wins += net;
    else losses -= net;
  }
  return {
    closedTrades: trades.length,
    netReturnPoints: wins - losses,
    profitFactor: losses ? wins / losses : null,
    winRatePct: trades.length ? 100 * trades.filter((t) => t.rawPct > roundTripCostPct).length / trades.length : 0,
  };
}
