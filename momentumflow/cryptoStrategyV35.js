// Compatibility exports for the execution bot.
// Crypto V51 execution is retired. These legacy export names now delegate only
// to the independent MACD peak/trough paper strategy.
import {
  CRYPTO_MACD_PEAK_DEFAULTS,
  evaluateCryptoMacdPeakCandidate,
  evaluateCryptoMacdPeakExit,
  buildCryptoMacdPeakBudget,
} from './cryptoMacdPeakStrategy.js';

export const CRYPTO_V35_DEFAULTS = Object.freeze({
  ...CRYPTO_MACD_PEAK_DEFAULTS,
  cryptoV35Enabled: false,
  cryptoV51Enabled: false,
  cryptoMacdPeakEnabled: true,
  cryptoV35MaxConcurrentPositions: CRYPTO_MACD_PEAK_DEFAULTS.cryptoMacdPeakMaxConcurrentPositions,
});

export function evaluateCryptoCandidateV35(args = {}) {
  return evaluateCryptoMacdPeakCandidate(args);
}

export function evaluateCryptoExitV35(args = {}) {
  return evaluateCryptoMacdPeakExit(args);
}

export function buildCryptoV35Budget(args = {}) {
  return buildCryptoMacdPeakBudget(args);
}
