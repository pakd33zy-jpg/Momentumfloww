// C62 crypto lead-lag momentum candidate. Long-only; closed 15-minute candles only.

const n = (value, fallback = NaN) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const price = (bar, key) => n(bar?.[key] ?? bar?.[{ o: 'open', h: 'high', l: 'low', c: 'close' }[key]]);

function atr(rows, end, length = 14) {
  let total = 0;
  for (let i = end - length + 1; i <= end; i += 1) {
    const high = price(rows[i], 'h');
    const low = price(rows[i], 'l');
    const previous = price(rows[i - 1], 'c');
    total += Math.max(high - low, Math.abs(high - previous), Math.abs(low - previous));
  }
  return total / length;
}

function structure(rows, end, length = 64) {
  const recent = rows.slice(end - length + 1, end + 1);
  const prior = rows.slice(end - (2 * length) + 1, end - length + 1);
  const recentHigh = Math.max(...recent.map((bar) => price(bar, 'h')));
  const recentLow = Math.min(...recent.map((bar) => price(bar, 'l')));
  const priorHigh = Math.max(...prior.map((bar) => price(bar, 'h')));
  const priorLow = Math.min(...prior.map((bar) => price(bar, 'l')));
  if (recentHigh > priorHigh && recentLow > priorLow) return 1;
  if (recentHigh < priorHigh && recentLow < priorLow) return -1;
  return 0;
}

function timestamp(bar) {
  return new Date(bar?.t ?? bar?.timestamp ?? 0).getTime();
}

function completed(rows, now = Date.now()) {
  const sorted = [...(rows || [])].sort((a, b) => timestamp(a) - timestamp(b));
  const bucket = 15 * 60 * 1000;
  return sorted.filter((bar) => timestamp(bar) + bucket <= now);
}

export function evaluateCryptoCandidateC62({ asset, bars15m, btcBars15m, now = Date.now() }) {
  const symbol = String(asset?.symbol || '').toUpperCase();
  if (symbol === 'BTC/USD') return { signal: null, reason: 'C62 uses BTC as leader, not target' };
  const rows = completed(bars15m, now);
  const btc = completed(btcBars15m, now);
  if (rows.length < 130 || btc.length < 130) return { signal: null, reason: 'C62 insufficient closed 15m history' };

  const end = rows.length - 1;
  const btcEnd = btc.length - 1;
  const bar = rows[end];
  const prior = rows[end - 1];
  const close = price(bar, 'c');
  const btcClose = price(btc[btcEnd], 'c');
  const assetAtr = atr(rows, end);
  const btcAtr = atr(btc, btcEnd);
  const btcMove = btcClose / price(btc[btcEnd - 8], 'c') - 1;
  const assetMove = close / price(rows[end - 8], 'c') - 1;
  const btcVolatility = btcAtr / btcClose;

  const checks = {
    btcUpStructure: structure(btc, btcEnd) === 1,
    assetNotDownStructure: structure(rows, end) >= 0,
    btcExpansion: btcVolatility >= 0.004,
    btcImpulse: btcMove >= 0.006,
    assetLagging: assetMove >= 0 && assetMove <= btcMove * 0.5,
    bullishClose: close > price(bar, 'o'),
    closedBreakout: close > price(prior, 'h'),
  };
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  if (failed.length) return { signal: null, reason: `C62 rejected: ${failed.join(', ')}`, diagnostics: { checks } };

  const riskPct = (2.5 * assetAtr / close) * 100;
  return {
    signal: {
      symbol,
      strategy: 'CRYPTO_C62_LEAD_LAG',
      score: 8,
      price: close,
      signal: {
        btcMovePct: btcMove * 100,
        assetMovePct: assetMove * 100,
        exitPlan: {
          stopLossPct: riskPct,
          takeProfitPct: riskPct * 3.25,
          estimatedRoundTripCostPct: 1,
          maxHoldMinutes: 96 * 15,
          trailTriggerPct: riskPct * 2.5,
          trailDistancePct: riskPct * 1.5,
          trailFloorPct: 0,
          scaleInAtRiskMultiple: 1,
          initialWeight: 0.5,
        },
      },
    },
    diagnostics: { checks, btcMove, assetMove, btcVolatility, riskPct },
  };
}
