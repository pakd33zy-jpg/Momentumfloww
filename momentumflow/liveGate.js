import express from 'express';
import { store } from './store.js';
import { REQUIRED_LIVE_GATE_ITEMS, evaluateLiveGate } from './safetyEngine.js';
import { hasCredentials } from './alpacaClient.js';

const router = express.Router();

function defaultConsents() {
  return Object.fromEntries(REQUIRED_LIVE_GATE_ITEMS.map((k) => [k, false]));
}

// GET /api/live-gate — current consent state + whether live trading is actually unlocked
router.get('/', (req, res) => {
  const consents = store.getConfig('liveGateConsents', defaultConsents());
  const evaluation = evaluateLiveGate({ consents, hasLiveCredentials: hasCredentials('live') });
  const consentedCount = Object.values(consents).filter(Boolean).length;
  res.json({
    consents,
    consented_count: consentedCount,
    total_required: REQUIRED_LIVE_GATE_ITEMS.length,
    live_trading_env_enabled: String(process.env.LIVE_TRADING_ENABLED).toLowerCase() === 'true',
    live_credentials_configured: hasCredentials('live'),
    unlocked: evaluation.allowed,
    reason: evaluation.reason,
  });
});

// POST /api/live-gate — body: { item: string, value: boolean }
router.post('/', (req, res) => {
  const { item, value } = req.body || {};
  if (!REQUIRED_LIVE_GATE_ITEMS.includes(item)) {
    return res.status(400).json({ error: `Unknown live gate item. Must be one of: ${REQUIRED_LIVE_GATE_ITEMS.join(', ')}` });
  }
  const consents = store.getConfig('liveGateConsents', defaultConsents());
  consents[item] = Boolean(value);
  store.setConfig('liveGateConsents', consents);
  res.json({ consents });
});

// POST /api/live-gate/reset — revoke all consents (e.g. after a halt, or manually)
router.post('/reset', (req, res) => {
  const consents = defaultConsents();
  store.setConfig('liveGateConsents', consents);
  res.json({ consents });
});

export default router;
