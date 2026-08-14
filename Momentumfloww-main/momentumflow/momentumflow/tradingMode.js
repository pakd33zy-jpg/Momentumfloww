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
// Switching to 'live' is refused unless the Live Gate is already fully unlocked —
// this mirrors the same hard check used by the live trade endpoint itself, so the
// mode switch can't become a second, weaker path into live trading.
router.post('/', (req, res) => {
  const { mode } = req.body || {};
  if (!['paper', 'live'].includes(mode)) {
    return res.status(400).json({ error: "mode must be 'paper' or 'live'" });
  }

  if (mode === 'live') {
    const consents = store.getConfig('liveGateConsents', {});
    const gate = evaluateLiveGate({ consents, hasLiveCredentials: hasCredentials('live') });
    if (!gate.allowed) {
      return res.status(403).json({ error: `Can't switch to live: ${gate.reason}` });
    }
  }

  const updated = store.setConfig('tradingMode', { mode, updated_at: new Date().toISOString() });
  res.json(updated);
});

export default router;
