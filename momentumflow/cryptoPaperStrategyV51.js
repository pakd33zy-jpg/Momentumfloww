export const CRYPTO_V51_PAPER_DEFAULTS = Object.freeze({
  minimumOpportunityScore: 0.56,
  maxConcurrentPositions: 8,
  riskFraction: 0.01,
  maxPositionFractionOfEquity: 0.12,
  maxTotalCryptoExposureFraction: 0.70,
  maxOpenRiskFraction: 0.08,
  estimatedRoundTripCostPct: 0.10,
  maxHoldMinutes: 60,
});

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, Number(x) || 0));
const closeOf = (bar) => Number(bar?.c ?? bar?.close ?? 0);
const highOf = (bar) => Number(bar?.h ?? bar?.high ?? 0);
const lowOf = (bar) => Number(bar?.l ?? bar?.low ?? 0);
const volOf = (bar) => Number(bar?.v ?? bar?.volume ?? 0);

function pct(a, b) {
  return a > 0 && b > 0 ? (b / a - 1) * 100 : 0;
}

function returnPct(bars = [], n = 1) {
  if (!Array.isArray(bars) || bars.length <= n) return 0;
  return pct(closeOf(bars.at(-(n + 1))), closeOf(bars.at(-1)));
}

function atrPct(bars = [], n = 20) {
  const rows = Array.isArray(bars) ? bars.slice(-(n + 1)) : [];
  if (rows.length < 3) return 0;
  const trs = [];
  for (let i = 1; i < rows.length; i += 1) {
    const h = highOf(rows[i]);
    const l = lowOf(rows[i]);
    const pc = closeOf(rows[i - 1]);
    if (!(h > 0) || !(l > 0) || !(pc > 0)) continue;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const last = closeOf(rows.at(-1));
  return trs.length && last > 0 ? (trs.reduce((a, b) => a + b, 0) / trs.length) / last * 100 : 0;
}

function volumeRatio(bars15m = [], n = 20) {
  const rows = Array.isArray(bars15m) ? bars15m.slice(-(n + 1)) : [];
  if (rows.length < 5) return 1;
  const latest = volOf(rows.at(-1));
  const prev = rows.slice(0, -1).map(volOf).filter((x) => x > 0);
  if (!(latest > 0) || !prev.length) return 1;
  const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
  return avg > 0 ? latest / avg : 1;
}

function spreadPct(snapshot = {}) {
  const bid = Number(snapshot?.latestQuote?.bp ?? snapshot?.latestQuote?.bidPrice ?? 0);
  const ask = Number(snapshot?.latestQuote?.ap ?? snapshot?.latestQuote?.askPrice ?? 0);
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
  return mid > 0 && ask >= bid ? (ask - bid) / mid * 100 : 0;
}

export function deriveCryptoV51StateFromMarket({ snapshot, bars15m = [], bars1h = [], bars1d = [], btcBars1h = [] } = {}) {
  const ret1h = returnPct(bars1h, 1);
  const ret6h = returnPct(bars1h, 6);
  const ret24h = returnPct(bars1h, 24);
  const btc6h = returnPct(btcBars1h, 6);
  const btc24h = returnPct(btcBars1h, 24);
  const relative6h = ret6h - btc6h;
  const relative24h = ret24h - btc24h;
  const volRatio = volumeRatio(bars15m);
  const spread = spreadPct(snapshot);
  const atr = atrPct(bars1h);

  const votes = [ret1h, ret6h, ret24h, relative6h, relative24h].map((x) => Math.sign(x));
  const persistence = clamp(votes.reduce((a, b) => a + b, 0) / votes.length, -1, 1);
  const sixHourHourlyPace = ret6h / 6;
  const acceleration = clamp((ret1h - sixHourHourlyPace) / Math.max(0.35, Math.abs(sixHourHourlyPace) + 0.35), -1, 1);
  const participation = clamp((volRatio - 1) / 1.5, -1, 1);
  const relativePressure = clamp((relative6h * 0.6 + relative24h * 0.4) / 3, -1, 1);
  const friction = clamp(spread / 0.75, 0, 1);
  const raw = 0.50 + persistence * 0.14 + acceleration * 0.18 + participation * 0.10 + relativePressure * 0.14 - friction * 0.12;

  return {
    persistence: Number(persistence.toFixed(4)),
    acceleration: Number(acceleration.toFixed(4)),
    participation: Number(participation.toFixed(4)),
    relativePressure: Number(relativePressure.toFixed(4)),
    friction: Number(friction.toFixed(4)),
    opportunityScore: Number(clamp(raw, 0, 1).toFixed(4)),
    context: {
      ret1hPct: ret1h,
      ret6hPct: ret6h,
      ret24hPct: ret24h,
      relative6hPct: relative6h,
      relative24hPct: relative24h,
      volumeRatio: volRatio,
      spreadPct: spread,
      atrPct: atr,
    },
  };
}

export function evaluateCryptoCandidateV51({ asset, snapshot, bars15m = [], bars1h = [], bars1d = [], btcBars1h = [], config = {} } = {}) {
  const cfg = { ...CRYPTO_V51_PAPER_DEFAULTS, ...config };
  const symbol = String(asset?.symbol || '').toUpperCase();
  const price = Number(snapshot?.latestTrade?.p ?? snapshot?.minuteBar?.c ?? 0);
  if (!symbol || !(price > 0)) return { signal: null, reason: 'V51: no tradable price', diagnostics: { score: 0 } };

  const state = deriveCryptoV51StateFromMarket({ snapshot, bars15m, bars1h, bars1d, btcBars1h });
  const threshold = Number(cfg.minimumOpportunityScore || 0.56);
  if (state.opportunityScore < threshold) {
    return { signal: null, reason: `V51: opportunity ${state.opportunityScore.toFixed(4)} below ${threshold.toFixed(4)}`, diagnostics: { score: Number((state.opportunityScore * 10).toFixed(2)), state } };
  }

  const atr = Math.max(0, Number(state.context?.atrPct || 0));
  const stopLossPct = clamp(atr > 0 ? atr * 1.25 : 1.25, 0.75, 3.0);
  const takeProfitPct = clamp(stopLossPct * 1.8, 1.25, 5.0);
  const score = Number((state.opportunityScore * 10).toFixed(2));

  return {
    signal: {
      symbol,
      name: asset?.name || symbol,
      assetClass: 'crypto',
      direction: 'LONG',
      strategy: 'CRYPTO_V51_PAPER_FORWARD',
      score,
      price,
      signal: {
        trigger: 'V51_FORWARD_OPPORTUNITY',
        v51State: state,
        exitPlan: {
          stopLossPct: Number(stopLossPct.toFixed(4)),
          takeProfitPct: Number(takeProfitPct.toFixed(4)),
          trailTriggerPct: Number(stopLossPct.toFixed(4)),
          trailDistancePct: Number((stopLossPct * 0.65).toFixed(4)),
          trailFloorPct: Number((stopLossPct * 0.25).toFixed(4)),
          maxHoldMinutes: Math.max(15, Number(cfg.maxHoldMinutes || 60)),
          estimatedRoundTripCostPct: Math.max(0, Number(cfg.estimatedRoundTripCostPct || 0.10)),
        },
      },
    },
    reason: null,
    diagnostics: { score, state },
  };
}

export function buildCryptoV51Budget({ equity, cash, currentCryptoExposure = 0, currentOpenRiskDollars = 0, signal, config = {} } = {}) {
  const cfg = { ...CRYPTO_V51_PAPER_DEFAULTS, ...config };
  const e = Math.max(0, Number(equity || 0));
  const c = Math.max(0, Number(cash || 0));
  if (!(e > 0) || !(c > 0)) return 0;
  const riskFraction = clamp(cfg.riskFraction, 0.001, 0.02);
  const maxPositionFraction = clamp(cfg.maxPositionFractionOfEquity, 0.01, 0.25);
  const maxExposureFraction = clamp(cfg.maxTotalCryptoExposureFraction, 0.10, 0.95);
  const maxRiskFraction = clamp(cfg.maxOpenRiskFraction, 0.01, 0.15);
  const stopPct = Math.max(0.25, Number(signal?.signal?.exitPlan?.stopLossPct || 1.25));
  const costPct = Math.max(0, Number(signal?.signal?.exitPlan?.estimatedRoundTripCostPct || 0.10));
  const riskRoom = Math.max(0, e * maxRiskFraction - Math.max(0, Number(currentOpenRiskDollars || 0)));
  const desiredRisk = Math.min(e * riskFraction, riskRoom);
  if (!(desiredRisk > 0)) return 0;
  const riskSized = desiredRisk / ((stopPct + costPct) / 100);
  const exposureRoom = Math.max(0, e * maxExposureFraction - Math.max(0, Number(currentCryptoExposure || 0)));
  return Math.max(0, Math.min(riskSized, e * maxPositionFraction, exposureRoom, c * 0.90));
}
