// EQUITY V71 — late-day synchronized expansion, PAPER SHADOW ONLY.
// Research acceptance: 2020-2026, 20 symbols, 30m + 15m confirmation,
// shared-capital replay, costs, best-trade removal, and neighbor stability.

export const EQUITY_V71_DEFAULTS = Object.freeze({
  symbols: ['SPY','QQQ','IWM','DIA','XLK','XLF','XLE','GLD','AAPL','MSFT','NVDA','AMZN','META','TSLA','JPM','BAC','XOM','CVX','WMT','UNH'],
  rangeThresholdPct: 0.2984,
  momentum2ThresholdPct: 0.2973,
  alignment4ThresholdPct: 0.8433,
  allowedSignalTimesET: ['13:00', '13:30'],
  holdMinutes: 120,
  maxPositions: 5,
  estimatedRoundTripCostPct: 0.06,
});

const number = (value) => Number(value);
const timestamp = (bar) => new Date(bar?.t ?? bar?.timestamp ?? 0).getTime();
const open = (bar) => number(bar?.o ?? bar?.open);
const high = (bar) => number(bar?.h ?? bar?.high);
const low = (bar) => number(bar?.l ?? bar?.low);
const close = (bar) => number(bar?.c ?? bar?.close);

export function easternTimeLabel(value) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const mapped = Object.fromEntries(parts.filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  return `${mapped.hour}:${mapped.minute}`;
}

export function normalizeV71Bars(rows = []) {
  return rows
    .filter((bar) => timestamp(bar) > 0 && open(bar) > 0 && high(bar) > 0 && low(bar) > 0 && close(bar) > 0)
    .sort((a, b) => timestamp(a) - timestamp(b));
}

export function evaluateV71Symbol(rows = [], signalTimestamp, config = {}) {
  const cfg = { ...EQUITY_V71_DEFAULTS, ...config };
  const bars = normalizeV71Bars(rows);
  const i = bars.findIndex((bar) => timestamp(bar) === Number(signalTimestamp));
  if (i < 4) return { qualifies: false, reason: 'insufficient synchronized history' };
  const bar = bars[i];
  if (!cfg.allowedSignalTimesET.includes(easternTimeLabel(signalTimestamp))) {
    return { qualifies: false, reason: 'outside V71 signal window' };
  }
  const rangePct = (high(bar) / low(bar) - 1) * 100;
  const momentum2Pct = (close(bar) / close(bars[i - 2]) - 1) * 100;
  const alignment4Pct = (close(bar) / close(bars[i - 4]) - 1) * 100;
  const diagnostics = { rangePct, momentum2Pct, alignment4Pct, signalClose: close(bar) };
  const qualifies =
    rangePct >= cfg.rangeThresholdPct &&
    momentum2Pct >= cfg.momentum2ThresholdPct &&
    alignment4Pct >= cfg.alignment4ThresholdPct;
  return {
    qualifies,
    reason: qualifies ? null : 'V71 expansion/alignment thresholds not met',
    diagnostics,
  };
}

export function evaluateEquityV71({ barsBySymbol = {}, signalTimestamp, config = {} } = {}) {
  const cfg = { ...EQUITY_V71_DEFAULTS, ...config };
  const spy = evaluateV71Symbol(barsBySymbol.SPY, signalTimestamp, cfg);
  if (!spy.qualifies) {
    return { signals: [], reason: `SPY confirmation failed: ${spy.reason}`, diagnostics: { SPY: spy.diagnostics } };
  }
  const candidates = [];
  const diagnostics = { SPY: spy.diagnostics };
  for (const symbol of cfg.symbols) {
    const result = evaluateV71Symbol(barsBySymbol[symbol], signalTimestamp, cfg);
    diagnostics[symbol] = result.diagnostics;
    if (!result.qualifies) continue;
    candidates.push({
      symbol,
      direction: 'LONG',
      strategy: 'EQUITY_V71_LATE_EXPANSION',
      version: 'V71',
      signalTimestamp: Number(signalTimestamp),
      score: result.diagnostics.alignment4Pct,
      diagnostics: result.diagnostics,
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  const signals = candidates.slice(0, cfg.maxPositions);
  return {
    signals,
    reason: signals.length ? null : 'No synchronized V71 candidates',
    diagnostics,
  };
}

export function nextBarOpen(rows = [], signalTimestamp) {
  const bar = normalizeV71Bars(rows).find((row) => timestamp(row) > Number(signalTimestamp));
  return bar ? { timestamp: timestamp(bar), price: open(bar) } : null;
}

export function timedExitClose(rows = [], signalTimestamp) {
  const target = Number(signalTimestamp) + 4 * 30 * 60 * 1000;
  const bar = normalizeV71Bars(rows).find((row) => timestamp(row) === target);
  return bar ? { timestamp: target, price: close(bar) } : null;
}

export function settleV71ShadowTrade({ entryPrice, exitPrice, config = {} } = {}) {
  const cfg = { ...EQUITY_V71_DEFAULTS, ...config };
  const entry = Number(entryPrice);
  const exit = Number(exitPrice);
  if (!(entry > 0) || !(exit > 0)) throw new Error('V71 invalid shadow prices');
  return Number((((exit / entry - 1) * 100) - cfg.estimatedRoundTripCostPct).toFixed(6));
}
