// Compatibility shim only.
// V35 crypto logic is retired from active execution. The existing bot imports
// these legacy symbol names, but every crypto decision and sizing call delegates
// to the independent V51 paper engine.

import {
  CRYPTO_V51_PAPER_DEFAULTS,
  evaluateCryptoCandidateV51,
  buildCryptoV51Budget,
} from './cryptoPaperStrategyV51.js';

export const CRYPTO_V35_DEFAULTS = Object.freeze({
  ...CRYPTO_V51_PAPER_DEFAULTS,
  cryptoV35Enabled: false,
  cryptoV35MaxConcurrentPositions: CRYPTO_V51_PAPER_DEFAULTS.maxConcurrentPositions,
  cryptoV35RiskFraction: CRYPTO_V51_PAPER_DEFAULTS.riskFraction,
});

export function evaluateCryptoCandidateV35(args = {}) {
  return evaluateCryptoCandidateV51(args);
}

export function buildCryptoV35Budget(args = {}) {
  return buildCryptoV51Budget(args);
}
