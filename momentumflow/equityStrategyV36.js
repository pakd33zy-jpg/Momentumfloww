// EQUITY STRATEGY V36 — research-only refinement of V35.
// Goal: preserve V35's profitable directional continuation behavior while
// reducing repeated losses during short-horizon regime flips/chop.
// V36 adds SOFT evidence adjustments only; hard rejects remain limited to
// invalid/untradeable/insufficient-data cases inherited from V35.

import { evaluateEquityCandidateV35, EQUITY_V35_DEFAULTS } from './equityStrategyV35.js';

export const EQUITY_V36_DEFAULTS = {
  ...EQUITY_V35_DEFAULTS,
  equityV36Enabled: true,
  equityV36ScoreThreshold: 5.8,
  equityV36CoherenceBonus: 0.55,
  equityV36MixedHorizonPenalty: 0.70,
  equityV36WeakImpulsePenalty: 0.35,
  equityV36RegimeConflictPenalty: 0.45,
};

const n = (v, fallback = NaN) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function signFor(direction) {
  return direction === 'SHORT' ? -1 : 1;
}

function coherenceAdjustment(signal, settings) {
  const metrics = signal?.signal?.metrics || {};
  const direction = String(signal?.direction || '').toUpperCase();
  const sign = signFor(direction);
  const directional = [metrics.r3, metrics.r15, metrics.r30]
    .map((x) => n(x, 0) * sign);

  const positive = directional.filter((x) => x > 0).length;
  const negative = directional.filter((x) => x < 0).length;
  const absImpulse = Math.abs(n(metrics.r3, 0)) + Math.abs(n(metrics.r15, 0));

  let adjustment = 0;
  const evidence = [];

  // V35's better stretches were directional continuation; reward agreement
  // across independent horizons rather than simply increasing raw momentum weight.
  if (positive === 3) {
    adjustment += n(settings.equityV36CoherenceBonus, 0.55);
    evidence.push('3/3 directional horizons coherent');
  } else if (positive <= 1 && negative >= 1) {
    adjustment -= n(settings.equityV36MixedHorizonPenalty, 0.70);
    evidence.push('mixed directional horizons');
  }

  // Weak impulse plus otherwise high score was a recurring V35 failure mode.
  if (absImpulse < 0.18) {
    adjustment -= n(settings.equityV36WeakImpulsePenalty, 0.35);
    evidence.push('weak 3m+15m impulse');
  }

  // Regime remains evidence, never a hard gate.
  if (metrics.regimeDirection && metrics.regimeDirection !== 'NEUTRAL' && metrics.regimeAligned === false) {
    adjustment -= n(settings.equityV36RegimeConflictPenalty, 0.45);
    evidence.push('regime conflict');
  }

  return { adjustment, evidence };
}

export function evaluateEquityCandidateV36(args = {}) {
  const settings = { ...EQUITY_V36_DEFAULTS, ...(args.config || {}) };
  const base = evaluateEquityCandidateV35({ ...args, config: settings });

  if (!base?.signal) {
    return {
      ...base,
      diagnostics: { ...(base?.diagnostics || {}), version: 'V36', inheritedFrom: 'V35' },
    };
  }

  const { adjustment, evidence } = coherenceAdjustment(base.signal, settings);
  const rawScore = n(base.signal.score, 0);
  const adjustedScore = Number(clamp(rawScore + adjustment, 0, 10).toFixed(2));
  const threshold = n(settings.equityV36ScoreThreshold, 5.8);

  if (adjustedScore < threshold) {
    return {
      signal: null,
      reason: 'V36: combined evidence below threshold',
      score: adjustedScore,
      diagnostics: {
        eligible: false,
        hardReject: false,
        version: 'V36',
        rawV35Score: rawScore,
        adjustment: Number(adjustment.toFixed(2)),
        adjustedScore,
        threshold,
        evidence,
        base: base.diagnostics,
      },
    };
  }

  return {
    ...base,
    signal: {
      ...base.signal,
      score: adjustedScore,
      strategy: 'EQUITY_V36_COHERENCE',
      signal: {
        ...base.signal.signal,
        version: 'V36',
        score: adjustedScore,
        threshold,
        v35RawScore: rawScore,
        v36Adjustment: Number(adjustment.toFixed(2)),
        evidence: [...(base.signal.signal?.evidence || []), ...evidence.map((x) => `V36 ${x}`)],
      },
    },
    diagnostics: {
      ...(base.diagnostics || {}),
      version: 'V36',
      rawV35Score: rawScore,
      adjustment: Number(adjustment.toFixed(2)),
      adjustedScore,
      threshold,
      evidence,
    },
  };
}
