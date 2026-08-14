import express from 'express';
import { store } from './store.js';
import { evaluateLiveGate } from './safetyEngine.js';
import { hasCredentials } from './alpacaClient.js';

const router = express.Router();

// GET /api/trading-mode
router.get('/', (req, res) => {
  const mode = store.getConfig('tradingMode', { mode: 'paper' });
  res.json(mode);
});

// POST /api/trading-mode — body: { mode: 'paper' | 'live' }
router.post('/', (req, res) => {
  const { mode } = req.body || {};
  if (!['paper', 'live'].includes(mode)) {
    return res.status(400).json({ error: "mode must be 'paper' or 'live'" });
  }

  if (mode === 'live') {
    const tradingConfig = store.getConfig('tradingConfig', {});
    if (tradingConfig.fastScalpEnabled === true) {
      return res.status(409).json({
        error: 'Fast Scalp is PAPER-only. Turn Fast Scalp OFF before switching to LIVE.',
      });
    }

    const consents = store.getConfig('liveGateConsents', {});
    const gate = evaluateLiveGate({
      consents,
      hasLiveCredentials: hasCredentials('live'),
    });

    if (!gate.allowed) {
      return res.status(403).json({
        error: `Can't switch to live: ${gate.reason}`,
      });
    }
  }

  const updated = store.setConfig('tradingMode', {
    mode,
    updated_at: new Date().toISOString(),
  });

  res.json(updated);
});

export default router;
