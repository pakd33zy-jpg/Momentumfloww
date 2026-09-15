export function replaySharedCapital(series, candidates, {
  startingEquity = 100_000,
  roundTripCostPct = 1,
  maxPositions = 5,
  positionRiskFraction = 0.005,
  totalRiskFraction = 0.02,
  positionNotionalFraction = 0.15,
  grossFraction = 0.60,
} = {}) {
  const feeRate = roundTripCostPct / 200;
  const events = new Map();
  const event = (t) => events.get(t) ?? (events.set(t, { bars: [], entries: [], exits: [] }), events.get(t));
  for (const [symbol, bars] of Object.entries(series)) for (const bar of bars) event(+bar.t).bars.push({ symbol, ...bar });
  for (const candidate of candidates) {
    event(+candidate.at).entries.push(candidate);
    if (candidate.exitAt != null) event(+candidate.exitAt).exits.push(candidate);
  }

  let cash = startingEquity;
  let peak = startingEquity;
  let maxDrawdown = 0;
  let skippedEntries = 0;
  let maxConcurrentPositions = 0;
  const positions = new Map();
  const marks = new Map();
  const tradeLog = [];
  const curve = [];
  const equity = () => cash + [...positions.values()].reduce((sum, p) => sum + p.qty * (marks.get(p.symbol) ?? p.entry), 0);

  for (const [t, batch] of [...events].sort(([a], [b]) => a - b)) {
    for (const bar of batch.bars) if (positions.has(bar.symbol)) marks.set(bar.symbol, +bar.o);
    for (const c of batch.entries.sort((a, b) => a.symbol.localeCompare(b.symbol))) {
      const eq = equity();
      const gross = eq - cash;
      const usedRisk = [...positions.values()].reduce((sum, p) => sum + p.qty * p.risk, 0);
      const risk = +c.risk;
      const entry = +c.entry;
      const qty = Math.floor(Math.max(0, Math.min(
        eq * positionNotionalFraction / (entry * (1 + positionNotionalFraction * feeRate)),
        (eq * grossFraction - gross) / (entry * (1 + grossFraction * feeRate)),
        cash / (entry * (1 + feeRate)),
        eq * positionRiskFraction / (risk + positionRiskFraction * entry * feeRate),
        (eq * totalRiskFraction - usedRisk) / (risk + totalRiskFraction * entry * feeRate),
      )) * 1e6) / 1e6;
      if (positions.size >= maxPositions || positions.has(c.symbol) || !(qty > 0) || !(risk > 0)) {
        skippedEntries++;
        continue;
      }
      const entryFee = qty * entry * feeRate;
      cash -= qty * entry + entryFee;
      positions.set(c.symbol, { ...c, qty, entryFee });
      marks.set(c.symbol, entry);
      maxConcurrentPositions = Math.max(maxConcurrentPositions, positions.size);
    }
    for (const c of batch.exits) {
      const p = positions.get(c.symbol);
      if (!p || p.at !== c.at) continue;
      const exit = +c.exit;
      const exitFee = p.qty * exit * feeRate;
      cash += p.qty * exit - exitFee;
      tradeLog.push({ symbol: p.symbol, at: p.at, exitAt: c.exitAt, netDollars: p.qty * (exit - p.entry) - p.entryFee - exitFee });
      positions.delete(c.symbol);
    }
    for (const bar of batch.bars) marks.set(bar.symbol, +bar.c);
    const marked = equity();
    peak = Math.max(peak, marked);
    maxDrawdown = Math.max(maxDrawdown, 100 * (peak - marked) / peak);
    curve.push({ t, equity: marked });
  }

  const endingEquity = equity();
  const wins = tradeLog.filter((x) => x.netDollars > 0).reduce((n, x) => n + x.netDollars, 0);
  const losses = -tradeLog.filter((x) => x.netDollars < 0).reduce((n, x) => n + x.netDollars, 0);
  return {
    startingEquity,
    endingEquity,
    returnPct: 100 * (endingEquity / startingEquity - 1),
    maxDailyCloseDrawdownPct: maxDrawdown,
    closedTrades: tradeLog.length,
    profitFactor: losses ? wins / losses : null,
    skippedEntries,
    maxConcurrentPositions,
    openPositions: positions.size,
    tradeLog,
    curve,
  };
}
