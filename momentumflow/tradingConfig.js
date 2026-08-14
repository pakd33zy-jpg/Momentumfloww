import express from 'express';
import { store } from './store.js';

const router = express.Router();

export const TRADING_DEFAULTS = {
  startingCapital: 100,
  riskPerTrade: 0.02,          // fraction: 0.02 = 2%
  maxTradesPerSession: 24,
  maxTradesPerMarket: 12,
  winRateTarget: 0.875,        // legacy paper simulator only
  dailyLossLimit: 0.10,        // fraction: 0.10 = 10%
  consecutiveStopLoss: 3,
  fastScalpEnabled: false,
  equityFocusMode: true,
  equityV20Enabled: true,
  equityFastScalpEnabled: false,
};

const NUMERIC_KEYS = [
  'startingCapital',
  'riskPerTrade',
  'maxTradesPerSession',
  'maxTradesPerMarket',
  'winRateTarget',
  'dailyLossLimit',
  'consecutiveStopLoss',
];

function asBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  return String(value || '').toLowerCase() === 'true';
}

function normalize(raw = {}) {
  const out = { ...TRADING_DEFAULTS, ...raw };

  // Backward compatibility with older field names.
  if (raw.tradesPerSession != null && raw.maxTradesPerSession == null) {
    out.maxTradesPerSession = Number(raw.tradesPerSession);
  }
  if (raw.tradesPerMarket != null && raw.maxTradesPerMarket == null) {
    out.maxTradesPerMarket = Number(raw.tradesPerMarket);
  }
  if (raw.riskPerTradePct != null && raw.riskPerTrade == null) {
    out.riskPerTrade = Number(raw.riskPerTradePct) / 100;
  }

  for (const k of NUMERIC_KEYS) out[k] = Number(out[k]);
  out.fastScalpEnabled = asBoolean(out.fastScalpEnabled);
  out.equityFocusMode = asBoolean(out.equityFocusMode);
  out.equityV20Enabled = asBoolean(out.equityV20Enabled);
  out.equityFastScalpEnabled = asBoolean(out.equityFastScalpEnabled);

  if (raw.updatedAt) out.updatedAt = String(raw.updatedAt);
  return out;
}

function validate(c) {
  if (!Number.isFinite(c.startingCapital) || c.startingCapital <= 0) return 'Starting capital must be greater than 0.';
  if (!Number.isFinite(c.riskPerTrade) || c.riskPerTrade <= 0 || c.riskPerTrade > 1) return 'Risk per trade must be greater than 0 and no more than 100%.';
  if (!Number.isInteger(c.maxTradesPerSession) || c.maxTradesPerSession < 1 || c.maxTradesPerSession > 1000) return 'Max trades per session must be an integer from 1 to 1000.';
  if (!Number.isInteger(c.maxTradesPerMarket) || c.maxTradesPerMarket < 1 || c.maxTradesPerMarket > 1000) return 'Max trades per market must be an integer from 1 to 1000.';
  if (!Number.isFinite(c.winRateTarget) || c.winRateTarget < 0 || c.winRateTarget > 1) return 'Paper win-rate target must be between 0% and 100%.';
  if (!Number.isFinite(c.dailyLossLimit) || c.dailyLossLimit <= 0 || c.dailyLossLimit > 1) return 'Daily loss limit must be greater than 0 and no more than 100%.';
  if (!Number.isInteger(c.consecutiveStopLoss) || c.consecutiveStopLoss < 1 || c.consecutiveStopLoss > 100) return 'Consecutive-loss halt must be an integer from 1 to 100.';
  return null;
}

router.get('/', (req, res) => {
  const current = normalize(store.getConfig('tradingConfig', TRADING_DEFAULTS));
  res.json({ ...current, source: 'railway-store' });
});

router.post('/', (req, res) => {
  const current = normalize(store.getConfig('tradingConfig', TRADING_DEFAULTS));
  const incoming = req.body || {};
  const merged = normalize({ ...current, ...incoming });
  const error = validate(merged);
  if (error) return res.status(400).json({ error });

  const selectedMode = store.getConfig('tradingMode', { mode: 'paper' }).mode;
  if (
    (
      merged.fastScalpEnabled ||
      merged.equityFastScalpEnabled
    ) &&
    selectedMode === 'live'
  ) {
    return res.status(409).json({
      error: 'Fast Scalp modes are PAPER-only. Switch to Paper Mode before enabling them.',
    });
  }

  merged.updatedAt = new Date().toISOString();
  store.setConfig('tradingConfig', merged);

  // liveBot reads strategyConfig, so mirror the toggle and use a short
  // cooldown while scalping. Turning Fast Scalp off restores v19's
  // normal 30-minute crypto cooldown.
  const strategyCurrent = store.getConfig('strategyConfig', {});
  store.setConfig('strategyConfig', {
    ...strategyCurrent,
    fastScalpEnabled: merged.fastScalpEnabled,
    equityFocusMode: merged.equityFocusMode,
    equityV20Enabled: merged.equityV20Enabled,
    equityFastScalpEnabled: merged.equityFastScalpEnabled,
    cryptoCooldownMinutes: merged.fastScalpEnabled ? 1 : 30,
    equityCooldownMinutes: merged.equityFastScalpEnabled ? 1 : 8,
  });

  res.json({ ...merged, source: 'railway-store' });
});

export default router;
