import express from 'express';
import { store } from './store.js';

const router = express.Router();

const DEFAULTS = {
  startingCapital: 100,
  // Fraction of account equity used as order notional for a new live position.
  // 0.02 = 2% of equity.
  riskPerTrade: 0.02,
  maxTradesPerSession: 24,
  maxTradesPerMarket: 12,
};

router.get('/', (req, res) => {
  const stored = store.getConfig('tradingConfig', DEFAULTS);
  // Backward compatibility with older config key.
  if (stored.riskPerTrade == null && stored.riskPerTradePct != null) {
    stored.riskPerTrade = Number(stored.riskPerTradePct) / 100;
  }
  res.json({ ...DEFAULTS, ...stored });
});

router.post('/', (req, res) => {
  const body = req.body || {};
  const current = store.getConfig('tradingConfig', DEFAULTS);
  const updated = { ...DEFAULTS, ...current };

  if (body.startingCapital != null) {
    const startingCapital = Number(body.startingCapital);
    if (!Number.isFinite(startingCapital) || startingCapital <= 0) {
      return res.status(400).json({ error: 'startingCapital must be a positive number' });
    }
    updated.startingCapital = startingCapital;
  }

  if (body.riskPerTrade != null) {
    const riskPerTrade = Number(body.riskPerTrade);
    if (!Number.isFinite(riskPerTrade) || riskPerTrade <= 0 || riskPerTrade > 1) {
      return res.status(400).json({ error: 'riskPerTrade must be a fraction greater than 0 and no more than 1 (0.02 = 2%)' });
    }
    updated.riskPerTrade = riskPerTrade;
  }

  store.setConfig('tradingConfig', updated);
  res.json(updated);
});

export default router;
