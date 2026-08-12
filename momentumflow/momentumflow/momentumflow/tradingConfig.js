import express from 'express';
import { store } from './store.js';

const router = express.Router();

// Canonical first-run defaults only. Stored user settings override these after Save Configuration.
export const TRADING_DEFAULTS = {
  startingCapital: 100,
  riskPerTrade: 0.02,          // fraction: 0.02 = 2%
  maxTradesPerSession: 24,
  maxTradesPerMarket: 12,
  winRateTarget: 0.875,        // legacy paper simulator only
  dailyLossLimit: 0.10,        // fraction: 0.10 = 10%
  consecutiveStopLoss: 3,
};

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

  for (const k of Object.keys(TRADING_DEFAULTS)) out[k] = Number(out[k]);
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

  // Server timestamp lets the frontend decide which copy is newest after a Railway restart.
  merged.updatedAt = new Date().toISOString();
  store.setConfig('tradingConfig', merged);
  res.json({ ...merged, source: 'railway-store' });
});

export default router;
