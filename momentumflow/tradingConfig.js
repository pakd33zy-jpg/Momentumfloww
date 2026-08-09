import express from 'express';
import { store } from '../store.js';

const router = express.Router();

const DEFAULTS = {
  startingCapital: 100,
  riskPerTradePct: 2,
  maxTradesPerSession: 24,
  maxTradesPerMarket: 12,
};

// GET /api/trading-config
router.get('/', (req, res) => {
  res.json(store.getConfig('tradingConfig', DEFAULTS));
});

// POST /api/trading-config — body: { startingCapital }
// Only startingCapital is user-editable for now; the trade caps stay server-owned
// safety limits (see safetyEngine.js), not something the UI can loosen.
router.post('/', (req, res) => {
  const { startingCapital } = req.body || {};
  const parsed = Number(startingCapital);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return res.status(400).json({ error: 'startingCapital must be a positive number' });
  }
  const current = store.getConfig('tradingConfig', DEFAULTS);
  const updated = { ...current, startingCapital: parsed };
  store.setConfig('tradingConfig', updated);
  res.json(updated);
});

export default router;
