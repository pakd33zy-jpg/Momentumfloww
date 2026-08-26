// EQUITY STRATEGY V34 — evidence-weighted, catalyst-aware, non-binary scoring.
//
// Design goals:
// - keep only genuine execution/data problems as hard blockers
// - score technical, regime, volume, VWAP, ORB and catalyst evidence instead of
//   killing a candidate because one soft rule is absent
// - evaluate LONG and SHORT independently, then choose the stronger valid path
// - preserve meaningful near-miss scores for diagnostics
// - use news/catalyst intelligence as supporting evidence, never as an automatic trade
// - validate in PAPER before LIVE

export const EQUITY_V34_DEFAULTS = {
  equityV34Enabled: true,
  equityV34ScoreThreshold: 6.3,
  equityV34StartMinutesET: 9 * 60 + 35,
  equityV34EndMinutesET: 15 * 60 + 50,
  equityV34MaxSpreadPct: 0.18,
  equityV34PreferredSpreadPct: 0.06,
  equityV34EstimatedRoundTripCostPct: 0.04,
  equityV34MinNetEdgePct: 0.08,
  equityV34MinBars: 12,
  equityV34OrbMinutes: 5,
  equityV34IntelligenceWeight: 0.14,
  equityV34MinStopPct: 0.28,
  equityV34MaxStopPct: 1.20,
  equityV34AtrStopMultiplier: 1.15,
  equityV34RewardRisk: 1.80,
  equityV34MinTakeProfitPct: 0.60,
  equityV34MaxHoldMinutes: 45,
  equityV34TrailTriggerR: 0.90,
  equityV34TrailDistanceR: 0.45,
  equityV34TrailFloorPct: 0.14,
  // Scanner compatibility. V34 intentionally lets more candidates reach the
  // full scorer instead of hard-gating on one-minute momentum.
  equityPrefilterMomentumPct: 0,
  maxDetailedEquities: 60,
  maxEquitySpreadPct: 0.18,
  equityCooldownMinutes: 6,
};

const ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const n = (v, fallback = NaN) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const avg = (xs) => {
  const good = (xs || []).filter(Number.isFinite);
  return good.length ? good.reduce((a, b) => a + b, 0) / good.length : 0;
};
const t = (b) => b?.t || b?.timestamp || null;
const o = (b) => n(b?.o ?? b?.open);
const h = (b) => n(b?.h ?? b?.high);
const l = (b) => n(b?.l ?? b?.low);
const c = (b) => n(b?.c ?? b?.close);
const v = (b) => n(b?.v ?? b?.volume, 0);
const r4 = (x) => Number(n(x, 0).toFixed(4));

function etParts(value = new Date()) {
  const p = Object.fromEntries(
    ET.formatToParts(value instanceof Date ? value : new Date(value))
      .map((x) => [x.type, x.value])
  );
  return {
    dateKey: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

export function equityStrategyWindowOpenV34({ now = new Date(), config = {} } = {}) {
  const s = { ...EQUITY_V34_DEFAULTS, ...config };
  const m = etParts(now).minutes;
  return m >= Number(s.equityV34StartMinutesET) && m <= Number(s.equityV34EndMinutesET);
}

function currentPrice(snapshot, bars) {
  return n(
    snapshot?.latestTrade?.p ?? snapshot?.minuteBar?.c ?? bars?.at(-1)?.c ?? snapshot?.dailyBar?.c
  );
}

function spreadPct(snapshot) {
  const ask = n(snapshot?.latestQuote?.ap);
  const bid = n(snapshot?.latestQuote?.bp);
  if (![ask, bid].every(Number.isFinite) || ask <= 0 || bid <= 0 || ask < bid) return null;
  const mid = (ask + bid) / 2;
  return mid > 0 ? ((ask - bid) / mid) * 100 : null;
}

function minuteMomentumPct(snapshot) {
  const open = n(snapshot?.minuteBar?.o);
  const close = n(snapshot?.minuteBar?.c ?? snapshot?.latestTrade?.p);
  if (!Number.isFinite(open) || !Number.isFinite(close) || open <= 0) return 0;
  return ((close - open) / open) * 100;
}

function dayMovePct(snapshot) {
  const open = n(snapshot?.dailyBar?.o ?? snapshot?.prevDailyBar?.c);
  const price = currentPrice(snapshot, []);
  return Number.isFinite(open) && open > 0 && Number.isFinite(price)
    ? ((price - open) / open) * 100
    : 0;
}

function trendPct(bars, lookback) {
  if (!Array.isArray(bars) || bars.length < lookback + 1) return 0;
  const a = c(bars.at(-1));
  const b = c(bars[bars.length - 1 - lookback]);
  return Number.isFinite(a) && Number.isFinite(b) && b > 0 ? ((a - b) / b) * 100 : 0;
}

function volumeRatio(bars, lookback = 12) {
  if (!Array.isArray(bars) || bars.length < 3) return 0;
  const current = v(bars.at(-1));
  const base = avg(bars.slice(Math.max(0, bars.length - 1 - lookback), -1).map(v).filter((x) => x > 0));
  return base > 0 ? current / base : 0;
}

function atrPct(bars, lookback = 14) {
  if (!Array.isArray(bars) || bars.length < 3) return 0;
  const start = Math.max(1, bars.length - lookback);
  const trs = [];
  for (let i = start; i < bars.length; i += 1) {
    const hi = h(bars[i]);
    const lo = l(bars[i]);
    const prev = c(bars[i - 1]);
    if (![hi, lo].every(Number.isFinite)) continue;
    const vals = [hi - lo];
    if (Number.isFinite(prev)) vals.push(Math.abs(hi - prev), Math.abs(lo - prev));
    trs.push(Math.max(...vals));
  }
  const price = c(bars.at(-1));
  return price > 0 ? (avg(trs) / price) * 100 : 0;
}

function sessionBars(bars, now) {
  const today = etParts(now).dateKey;
  return (bars || []).filter((bar) => {
    const stamp = t(bar);
    if (!stamp) return false;
    const p = etParts(stamp);
    return p.dateKey === today && p.minutes >= 570 && p.minutes <= 960;
  });
}

function vwap(rows) {
  let pv = 0;
  let vv = 0;
  for (const bar of rows || []) {
    const hi = h(bar); const lo = l(bar); const close = c(bar); const vol = v(bar);
    if (![hi, lo, close].every(Number.isFinite) || vol <= 0) continue;
    pv += ((hi + lo + close) / 3) * vol;
    vv += vol;
  }
  return vv > 0 ? pv / vv : null;
}

function openingRange(rows, now, minutes = 5) {
  const session = sessionBars(rows, now);
  const cutoff = 570 + Number(minutes || 5);
  const opening = session.filter((bar) => etParts(t(bar)).minutes < cutoff);
  if (opening.length < 3) return null;
  const highs = opening.map(h).filter(Number.isFinite);
  const lows = opening.map(l).filter(Number.isFinite);
  if (!highs.length || !lows.length) return null;
  return { high: Math.max(...highs), low: Math.min(...lows) };
}

function regimeBias(regime) {
  const text = JSON.stringify(regime || '').toLowerCase();
  if (/bear|risk.?off|down|weak/.test(text)) return -1;
  if (/bull|risk.?on|up|strong/.test(text)) return 1;
  return 0;
}

function hardReject(reason, metrics = {}) {
  return {
    signal: null,
    diagnostics: {
      reason,
      score: null,
      hardReject: true,
      metrics,
      long: { eligible: false, reason, score: null },
      short: { eligible: false, reason, score: null },
      threshold: null,
    },
  };
}

function exitPlan(settings, atr) {
  const cost = Math.max(0, Number(settings.equityV34EstimatedRoundTripCostPct || 0.04));
  const stop = clamp(
    Math.max(
      Number(settings.equityV34MinStopPct || 0.28),
      atr * Number(settings.equityV34AtrStopMultiplier || 1.15)
    ),
    Number(settings.equityV34MinStopPct || 0.28),
    Number(settings.equityV34MaxStopPct || 1.20)
  );
  const take = Math.max(
    Number(settings.equityV34MinTakeProfitPct || 0.60),
    cost + Number(settings.equityV34RewardRisk || 1.8) * (stop + cost)
  );
  return {
    stopLossPct: Number(stop.toFixed(4)),
    takeProfitPct: Number(take.toFixed(4)),
    estimatedRoundTripCostPct: Number(cost.toFixed(4)),
    trailTriggerPct: Number((stop * Number(settings.equityV34TrailTriggerR || 0.9)).toFixed(4)),
    trailDistancePct: Number((stop * Number(settings.equityV34TrailDistanceR || 0.45)).toFixed(4)),
    trailFloorPct: Number(Math.max(Number(settings.equityV34TrailFloorPct || 0.14), cost + 0.03).toFixed(4)),
    maxHoldMinutes: Number(settings.equityV34MaxHoldMinutes || 45),
  };
}

function scoreDirection({
  direction, asset, price, spread, momentum, dayMove, trend5, trend15, trend30,
  volRatio, atr, sessionVwap, orb, marketRegime, intelligence, settings,
}) {
  const sign = direction === 'LONG' ? 1 : -1;
  const fav = (x) => sign * Number(x || 0);
  const reasons = [];
  const penalties = [];
  const components = {};

  if (direction === 'SHORT' && !(asset?.shortable === true && asset?.easy_to_borrow === true)) {
    return {
      eligible: false,
      reason: 'stock is not easy-to-borrow shortable',
      score: null,
      direction,
    };
  }

  let score = 2.6;

  // Multi-horizon trend: evidence, not a gate.
  let trendScore = 0;
  if (fav(trend15) >= 0.18 && fav(trend30) >= 0.25) trendScore = 1.65;
  else if (fav(trend15) > 0 && fav(trend30) > 0) trendScore = 1.15;
  else if (fav(trend5) > 0 || fav(trend15) > 0) trendScore = 0.55;
  else if (fav(trend15) < -0.20) trendScore = -0.75;
  score += trendScore;
  components.trend = trendScore;
  (trendScore >= 0 ? reasons : penalties).push(`trend ${r4(trend5)}/${r4(trend15)}/${r4(trend30)}%`);

  // Immediate tape.
  let momentumScore = 0;
  if (fav(momentum) >= 0.08) momentumScore = 1.20;
  else if (fav(momentum) >= 0.03) momentumScore = 0.85;
  else if (fav(momentum) > 0) momentumScore = 0.35;
  else if (fav(momentum) <= -0.08) momentumScore = -0.65;
  else if (fav(momentum) < 0) momentumScore = -0.25;
  score += momentumScore;
  components.momentum = momentumScore;
  (momentumScore >= 0 ? reasons : penalties).push(`minute momentum ${r4(momentum)}%`);

  // Volume confirmation.
  let volumeScore = 0;
  if (volRatio >= 1.75) volumeScore = 1.05;
  else if (volRatio >= 1.20) volumeScore = 0.75;
  else if (volRatio >= 0.85) volumeScore = 0.35;
  else if (volRatio > 0) volumeScore = -0.40;
  score += volumeScore;
  components.volume = volumeScore;
  (volumeScore >= 0 ? reasons : penalties).push(`relative volume ${r4(volRatio)}x`);

  // VWAP structure. Near-VWAP reclaims/pullbacks and clean continuation can both score.
  let vwapScore = 0;
  let vwapDistancePct = null;
  if (Number.isFinite(sessionVwap) && sessionVwap > 0) {
    vwapDistancePct = ((price - sessionVwap) / sessionVwap) * 100;
    const favorableDistance = fav(vwapDistancePct);
    if (favorableDistance >= 0 && favorableDistance <= 0.35) vwapScore = 1.10;
    else if (favorableDistance > 0.35 && favorableDistance <= 0.90) vwapScore = 0.65;
    else if (favorableDistance < 0 && favorableDistance >= -0.18 && fav(momentum) > 0) vwapScore = 0.70;
    else if (favorableDistance < -0.50) vwapScore = -0.45;
  }
  score += vwapScore;
  components.vwap = vwapScore;
  if (Number.isFinite(vwapDistancePct)) (vwapScore >= 0 ? reasons : penalties).push(`VWAP distance ${r4(vwapDistancePct)}%`);

  // Opening-range breakout is one path, not a universal requirement.
  let orbScore = 0;
  let orbBreak = false;
  if (orb) {
    orbBreak = direction === 'LONG' ? price > orb.high : price < orb.low;
    const range = Math.max(1e-9, orb.high - orb.low);
    const distance = direction === 'LONG' ? price - orb.high : orb.low - price;
    if (orbBreak && distance / range <= 0.80) orbScore = 1.15;
    else if (orbBreak) orbScore = 0.55;
    else {
      const near = direction === 'LONG'
        ? (orb.high - price) / price * 100
        : (price - orb.low) / price * 100;
      if (near >= 0 && near <= 0.15 && fav(momentum) > 0) orbScore = 0.40;
    }
  }
  score += orbScore;
  components.orb = orbScore;
  if (orbScore > 0) reasons.push(orbBreak ? 'opening-range breakout' : 'near opening-range trigger');

  // Day structure.
  let dayScore = 0;
  if (fav(dayMove) >= 2.0) dayScore = 0.75;
  else if (fav(dayMove) >= 0.50) dayScore = 0.45;
  else if (fav(dayMove) > 0) dayScore = 0.20;
  else if (fav(dayMove) <= -2.0) dayScore = -0.45;
  score += dayScore;
  components.dayMove = dayScore;

  // Market regime is supporting evidence only.
  const rb = regimeBias(marketRegime);
  const regimeScore = rb === 0 ? 0 : rb === sign ? 0.55 : -0.30;
  score += regimeScore;
  components.regime = regimeScore;
  if (rb !== 0) (regimeScore >= 0 ? reasons : penalties).push(regimeScore >= 0 ? 'market regime aligned' : 'market regime opposed');

  // Fresh business/news intelligence. Positive net score helps LONG, negative helps SHORT.
  const intelNet = n(intelligence?.netScore, 0);
  const intelDirectional = sign * intelNet;
  const intelWeight = Math.max(0, Number(settings.equityV34IntelligenceWeight || 0.14));
  const intelligenceScore = clamp(intelDirectional * intelWeight, -1.20, 1.20);
  score += intelligenceScore;
  components.intelligence = intelligenceScore;
  if (Math.abs(intelligenceScore) >= 0.15) {
    (intelligenceScore > 0 ? reasons : penalties).push(
      `${intelligenceScore > 0 ? 'supportive' : 'opposing'} catalyst/news ${r4(intelNet)}`
    );
  }

  // Execution quality.
  let spreadScore = 0;
  if (spread == null) spreadScore = -0.15;
  else if (spread <= Number(settings.equityV34PreferredSpreadPct || 0.06)) spreadScore = 0.70;
  else if (spread <= 0.10) spreadScore = 0.35;
  else spreadScore = -0.35;
  score += spreadScore;
  components.spread = spreadScore;

  // Volatility/edge check. Do not hard-gate ordinary volatility; score it.
  const cost = Math.max(0, Number(settings.equityV34EstimatedRoundTripCostPct || 0.04));
  const required = cost + Math.max(0, Number(settings.equityV34MinNetEdgePct || 0.08));
  const expectedMove = Math.max(
    atr * 1.35,
    Math.abs(trend15) * 1.35,
    Math.abs(dayMove) * 0.18,
    Math.abs(momentum) * 2.5
  );
  let edgeScore = 0;
  if (expectedMove >= required * 3) edgeScore = 0.75;
  else if (expectedMove >= required * 1.5) edgeScore = 0.40;
  else if (expectedMove >= required) edgeScore = 0.15;
  else edgeScore = -0.75;
  score += edgeScore;
  components.edge = edgeScore;
  (edgeScore >= 0 ? reasons : penalties).push(`expected move ${r4(expectedMove)}% vs required ${r4(required)}%`);

  // Independent playbook bonus: strongest valid path wins; no candidate must pass all paths.
  const playbooks = {
    breakout: Math.max(0, orbScore) + Math.max(0, momentumScore) + Math.max(0, volumeScore),
    vwap: Math.max(0, vwapScore) + Math.max(0, momentumScore) + Math.max(0, trendScore),
    continuation: Math.max(0, trendScore) + Math.max(0, momentumScore) + Math.max(0, volumeScore),
    catalyst: Math.max(0, intelligenceScore) + Math.max(0, momentumScore) + Math.max(0, volumeScore) + Math.max(0, dayScore),
  };
  const [playbook, playbookRaw] = Object.entries(playbooks).sort((a, b) => b[1] - a[1])[0];
  const playbookBonus = clamp(playbookRaw * 0.22, 0, 0.85);
  score += playbookBonus;
  components.playbook = playbookBonus;

  const finalScore = Number(clamp(score, 0, 10).toFixed(2));
  const threshold = Number(settings.equityV34ScoreThreshold || 6.3);

  return {
    eligible: true,
    direction,
    score: finalScore,
    threshold,
    qualified: finalScore >= threshold,
    reason: finalScore >= threshold ? null : `evidence score ${finalScore}/10 below threshold ${threshold}`,
    playbook: `V34_${String(playbook).toUpperCase()}`,
    components,
    reasons,
    penalties,
    metrics: {
      price: r4(price), spreadPct: spread == null ? null : r4(spread),
      momentumPct: r4(momentum), dayMovePct: r4(dayMove),
      trend5Pct: r4(trend5), trend15Pct: r4(trend15), trend30Pct: r4(trend30),
      recentVolumeRatio: r4(volRatio), atrPct: r4(atr),
      vwap: Number.isFinite(sessionVwap) ? Number(sessionVwap.toFixed(6)) : null,
      vwapDistancePct: Number.isFinite(vwapDistancePct) ? r4(vwapDistancePct) : null,
      intelligenceNetScore: r4(intelNet), expectedMovePct: r4(expectedMove), requiredEdgePct: r4(required),
    },
  };
}

export function evaluateEquityCandidateV34({
  asset,
  snapshot,
  bars = [],
  marketRegime = null,
  intelligence = null,
  config = {},
  now = new Date(),
  mode = 'paper',
} = {}) {
  const settings = { ...EQUITY_V34_DEFAULTS, ...config };
  const price = currentPrice(snapshot, bars);
  const spread = spreadPct(snapshot);

  if (!Number.isFinite(price) || price <= 0) {
    return hardReject('invalid equity price');
  }
  if (spread != null && spread > Number(settings.equityV34MaxSpreadPct || 0.18)) {
    return hardReject(`untradeable spread ${spread.toFixed(3)}% above ${settings.equityV34MaxSpreadPct}%`, { spreadPct: r4(spread) });
  }

  const minBars = Math.max(6, Number(settings.equityV34MinBars || 12));
  if (!Array.isArray(bars) || bars.length < minBars) {
    return hardReject(`insufficient essential minute history (${bars?.length || 0}/${minBars})`);
  }

  const rows = [...bars].filter((bar) => Number.isFinite(c(bar))).sort((a, b) => new Date(t(a) || 0) - new Date(t(b) || 0));
  if (rows.length < minBars) return hardReject(`insufficient valid minute history (${rows.length}/${minBars})`);

  const momentum = minuteMomentumPct(snapshot);
  const dayMove = dayMovePct(snapshot);
  const trend5 = trendPct(rows, Math.min(5, rows.length - 1));
  const trend15 = trendPct(rows, Math.min(15, rows.length - 1));
  const trend30 = trendPct(rows, Math.min(30, rows.length - 1));
  const volRatio = volumeRatio(rows, 12);
  const atr = atrPct(rows, 14);
  const sess = sessionBars(rows, now);
  const sessionVwap = vwap(sess.length >= 3 ? sess : rows.slice(-60));
  const orb = openingRange(rows, now, Number(settings.equityV34OrbMinutes || 5));

  const common = {
    asset, price, spread, momentum, dayMove, trend5, trend15, trend30,
    volRatio, atr, sessionVwap, orb, marketRegime, intelligence, settings,
  };

  const long = scoreDirection({ direction: 'LONG', ...common });
  const short = scoreDirection({ direction: 'SHORT', ...common });
  const valid = [long, short].filter((x) => x?.eligible && Number.isFinite(Number(x.score)));
  valid.sort((a, b) => Number(b.score) - Number(a.score));
  const best = valid[0] || null;
  const threshold = Number(settings.equityV34ScoreThreshold || 6.3);

  const diagnostics = {
    threshold,
    score: best?.score ?? null,
    reason: best?.qualified ? null : best?.reason || 'no valid direction',
    hardReject: false,
    long,
    short,
    metrics: best?.metrics || null,
  };

  if (!best || !best.qualified) return { signal: null, diagnostics };

  const plan = exitPlan(settings, atr);
  const signal = {
    symbol: asset?.symbol,
    assetClass: 'us_equity',
    direction: best.direction,
    strategy: 'EQUITY_V34_EVIDENCE',
    score: best.score,
    price,
    signal: {
      strategy: 'EQUITY_V34_EVIDENCE',
      playbook: best.playbook,
      score: best.score,
      trend5Pct: r4(trend5),
      trend15Pct: r4(trend15),
      trend30Pct: r4(trend30),
      recentVolumeRatio: r4(volRatio),
      spreadPct: spread == null ? null : r4(spread),
      minuteMomentumPct: r4(momentum),
      dayMovePct: r4(dayMove),
      atrPct: r4(atr),
      vwap: Number.isFinite(sessionVwap) ? Number(sessionVwap.toFixed(6)) : null,
      intelligenceNetScore: r4(intelligence?.netScore || 0),
      intelligenceReasons: intelligence?.reasons || [],
      components: best.components,
      evidence: best.reasons,
      penalties: best.penalties,
      mode,
      exitPlan: plan,
    },
  };

  return { signal, diagnostics };
}
