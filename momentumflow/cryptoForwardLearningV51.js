// CRYPTO V51 FORWARD-LEARNING SHADOW MODEL
// Research-only. Uses live market observations to learn what conditions precede
// future movement. It never places orders and must not bypass live-trading gates.

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, Number(x) || 0));

export const CRYPTO_V51_SHADOW_DEFAULTS = Object.freeze({
  horizonMinutes: 60,
  sampleEveryMinutes: 5,
  maxRows: 5000,
  minimumOpportunityScore: 0.56,
});

function metric(v35Result, key, fallback = 0) {
  const fromSignal = v35Result?.signal?.signal?.[key];
  if (Number.isFinite(Number(fromSignal))) return Number(fromSignal);
  const fromDiag = v35Result?.diagnostics?.metrics?.[key];
  if (Number.isFinite(Number(fromDiag))) return Number(fromDiag);
  return fallback;
}

function triggerOf(v35Result) {
  return v35Result?.signal?.signal?.trigger || v35Result?.diagnostics?.metrics?.trigger || 'UNKNOWN';
}

// Compress correlated evidence into a few forward-looking state variables.
// These are not extra entry filters. They are the vocabulary used to learn
// which market states actually precede favorable future returns.
export function deriveCryptoV51State(v35Result = {}) {
  const ret1h = metric(v35Result, 'ret1hPct');
  const ret6h = metric(v35Result, 'ret6hPct');
  const ret24h = metric(v35Result, 'ret24hPct');
  const relative6h = metric(v35Result, 'relative6hPct');
  const relative24h = metric(v35Result, 'relative24hPct');
  const volumeRatio = Math.max(0, metric(v35Result, 'volumeRatio', 1));
  const spreadPct = Math.max(0, metric(v35Result, 'spreadPct', metric(v35Result, 'observedSpreadPct', 0)));
  const atrPct = Math.max(0, metric(v35Result, 'atrPct', 0));

  // Persistence asks whether movement agrees across horizons and relative strength.
  const votes = [ret1h, ret6h, ret24h, relative6h, relative24h].map((x) => Math.sign(x));
  const persistence = clamp(votes.reduce((a, b) => a + b, 0) / votes.length, -1, 1);

  // Acceleration compares the newest hourly pace with the recent six-hour pace.
  // Positive means the move is strengthening now, not merely that it was strong earlier.
  const sixHourHourlyPace = ret6h / 6;
  const acceleration = clamp((ret1h - sixHourHourlyPace) / Math.max(0.35, Math.abs(sixHourHourlyPace) + 0.35), -1, 1);

  // Participation measures whether the move has unusual volume behind it.
  const participation = clamp((volumeRatio - 1) / 1.5, -1, 1);

  // Relative pressure distinguishes coin-specific demand from a broad BTC tide.
  const relativePressure = clamp((relative6h * 0.6 + relative24h * 0.4) / 3, -1, 1);

  // Friction penalizes conditions in which spread can consume a large part of the edge.
  const friction = clamp(spreadPct / 0.75, 0, 1);

  // Opportunity score is intentionally compact. The weights are hypotheses that
  // live forward outcomes will validate or reject; they are not treated as proven edge.
  const raw =
    0.50 +
    persistence * 0.14 +
    acceleration * 0.18 +
    participation * 0.10 +
    relativePressure * 0.14 -
    friction * 0.12;

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
      volumeRatio,
      spreadPct,
      atrPct,
      trigger: triggerOf(v35Result),
    },
  };
}

export function buildCryptoV51Observation({ symbol, price, v35Result, observedAt = new Date().toISOString(), config = {} } = {}) {
  const cfg = { ...CRYPTO_V51_SHADOW_DEFAULTS, ...config };
  const cleanSymbol = String(symbol || '').toUpperCase();
  const entryPrice = Number(price);
  if (!cleanSymbol || !(entryPrice > 0)) return null;
  const state = deriveCryptoV51State(v35Result);
  return {
    id: `cv51-${cleanSymbol.replace(/[^A-Z0-9]/g, '')}-${new Date(observedAt).getTime()}`,
    strategy: 'CRYPTO_V51_FORWARD_SHADOW',
    version: 'V51-SHADOW',
    symbol: cleanSymbol,
    observedAt,
    entryPrice,
    horizonMinutes: Math.max(5, Number(cfg.horizonMinutes || 60)),
    status: 'pending',
    hypothesis: state.opportunityScore >= Number(cfg.minimumOpportunityScore || 0.56) ? 'FAVORABLE_LONG' : 'NO_EDGE',
    ...state,
  };
}

export function settleCryptoV51Observation(row, currentPrice, settledAt = new Date().toISOString()) {
  const entry = Number(row?.entryPrice);
  const exit = Number(currentPrice);
  if (!(entry > 0) || !(exit > 0)) return row;
  const forwardReturnPct = (exit / entry - 1) * 100;
  return {
    ...row,
    status: 'settled',
    settledAt,
    exitPrice: exit,
    forwardReturnPct: Number(forwardReturnPct.toFixed(6)),
    favorable: row?.hypothesis === 'FAVORABLE_LONG' ? forwardReturnPct > 0 : null,
  };
}

export function shouldSampleCryptoV51(existingRows = [], symbol, now = Date.now(), config = {}) {
  const cfg = { ...CRYPTO_V51_SHADOW_DEFAULTS, ...config };
  const last = [...existingRows].reverse().find((row) => row?.symbol === symbol);
  if (!last) return true;
  const lastMs = new Date(last.observedAt || 0).getTime();
  return !Number.isFinite(lastMs) || now - lastMs >= Math.max(1, Number(cfg.sampleEveryMinutes || 5)) * 60000;
}

export function summarizeCryptoV51(rows = []) {
  const settled = rows.filter((r) => r?.status === 'settled' && Number.isFinite(Number(r.forwardReturnPct)));
  const favorable = settled.filter((r) => r.hypothesis === 'FAVORABLE_LONG');
  const wins = favorable.filter((r) => Number(r.forwardReturnPct) > 0);
  const avg = favorable.length ? favorable.reduce((s, r) => s + Number(r.forwardReturnPct), 0) / favorable.length : null;
  return {
    totalObservations: rows.length,
    pending: rows.filter((r) => r?.status === 'pending').length,
    settled: settled.length,
    favorableSamples: favorable.length,
    favorableWinRate: favorable.length ? Number((wins.length / favorable.length).toFixed(4)) : null,
    favorableAverageForwardReturnPct: avg == null ? null : Number(avg.toFixed(6)),
  };
}
