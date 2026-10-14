/**
 * Pure PAPER research only. Evaluates time-stamped external probability forecasts
 * against indicative Kalshi YES/NO asks and settled outcomes. NEVER places orders.
 * Do not mistake a profitable synthetic fixture for a profitable live model.
 */
export const EDGE_DEFAULTS = Object.freeze({
  startingBalance: 1000,
  maxStakeFraction: 0.01,
  minEdgePerContract: 0.05,
  maxContracts: 100,
});

function validProbability(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}
function validPrice(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1;
}
function validFee(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1;
}
function validTime(v) {
  return typeof v === 'string' && Number.isFinite(Date.parse(v));
}
function rounded(v) {
  return Number(v.toFixed(4));
}

/**
 * Inputs must be recorded BEFORE outcome. Each record needs:
 * {ticker,forecastProbabilityYes,forecastCreatedAt,quoteObservedAt,
 * closeTime,yesAsk,noAsk,yesFee,noFee,result:'yes'|'no'}
 * If the true fee or historical ask is unknown, SKIP, do not assume zero cost.
 * Prices must be independently sourced and matched to the forecast timestamp.
 */
export function evaluateForecast(row, settings = EDGE_DEFAULTS) {
  if (!row || !validProbability(row.forecastProbabilityYes) ||
      !validPrice(row.yesAsk) || !validPrice(row.noAsk) ||
      !validFee(row.yesFee) || !validFee(row.noFee)) {
    return { eligible: false, reason: 'missing-probability-quote-or-fees' };
  }
  if (!validTime(row.forecastCreatedAt) || !validTime(row.quoteObservedAt) ||
      !validTime(row.closeTime) ||
      Date.parse(row.forecastCreatedAt) > Date.parse(row.quoteObservedAt) ||
      Date.parse(row.quoteObservedAt) >= Date.parse(row.closeTime)) {
    return { eligible: false, reason: 'time-order-unsafe' };
  }

  const yesEV = row.forecastProbabilityYes - row.yesAsk - row.yesFee;
  const noEV = 1 - row.forecastProbabilityYes - row.noAsk - row.noFee;
  const side = yesEV >= noEV ? 'yes' : 'no';
  const ev = Math.max(yesEV, noEV);
  if (ev < settings.minEdgePerContract) {
    return { eligible: false, reason: 'no-edge-after-fees', bestEdge: rounded(ev) };
  }
  const ask = side === 'yes' ? row.yesAsk : row.noAsk;
  const fee = side === 'yes' ? row.yesFee : row.noFee;
  return { eligible: true, ticker: row.ticker, side, ask, fee,
    expectedNetDollarsPerContract: rounded(ev),
    result: row.result, quoteObservedAt: row.quoteObservedAt };
}

export function paperBacktest(rows = [], overrides = {}) {
  const cfg = { ...EDGE_DEFAULTS, ...overrides };
  if (!Number.isFinite(cfg.startingBalance) || cfg.startingBalance <= 0 ||
      cfg.maxStakeFraction <= 0 || cfg.maxStakeFraction > 0.05 ||
      cfg.minEdgePerContract < 0 || cfg.maxContracts < 1) {
    throw new Error('Invalid paper risk settings');
  }
  let balance = cfg.startingBalance;
  let peak = balance;
  let maxDrawdownPct = 0;
  let wins = 0;
  let losses = 0;
  let totalForecasts = 0;
  const skipped = {};
  const trades = [];
  // Chronological order, no hindsight trade selection.
  const ordered = [...rows].sort((a, b) =>
    Date.parse(a?.quoteObservedAt ?? 0) - Date.parse(b?.quoteObservedAt ?? 0));
  for (const row of ordered) {
    totalForecasts++;
    const signal = evaluateForecast(row, cfg);
    if (!signal.eligible) {
      skipped[signal.reason] = (skipped[signal.reason] || 0) + 1;
      continue;
    }
    // Forecast evaluation requires genuine settled results; no claims from open bets.
    if (row.result !== 'yes' && row.result !== 'no') {
      skipped['unsettled-or-missing-result'] =
        (skipped['unsettled-or-missing-result'] || 0) + 1;
      continue;
    }
    const costPerContract = signal.ask + signal.fee;
    const n = Math.min(cfg.maxContracts, Math.floor(balance * cfg.maxStakeFraction / costPerContract));
    if (n < 1) {
      skipped['insufficient-risk-budget'] = (skipped['insufficient-risk-budget'] || 0) + 1;
      continue;
    }
    const won = signal.side === row.result;
    const pnl = n * ((won ? 1 : 0) - costPerContract);
    balance += pnl;
    if (won) wins++; else losses++;
    peak = Math.max(peak, balance);
    maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - balance) / peak) * 100);
    trades.push({ ticker: signal.ticker, side: signal.side, contracts: n, won,
      expectedEdgePerContract: signal.expectedNetDollarsPerContract,
      entryCost: rounded(costPerContract * n), pnl: rounded(pnl), balance: rounded(balance) });
  }
  return {
    source: 'user-supplied-timestamped-historical-forecasts',
    simulated: true,
    note: 'Quote-based hypothetical fills; no guarantee of execution. Does not establish real-world profitability.',
    initialBalance: cfg.startingBalance,
    endBalance: rounded(balance),
    pnl: rounded(balance - cfg.startingBalance),
    returnPct: rounded((balance / cfg.startingBalance - 1) * 100),
    maxDrawdownPct: rounded(maxDrawdownPct),
    totalForecasts, tradesExecuted: trades.length, wins, losses,
    winRatePct: trades.length ? rounded(wins / trades.length * 100) : null,
    skipped, trades,
  };
}
