import express from 'express';
import crypto from 'crypto';
import { encrypt, maskSecret } from './crypto.js';
import { store } from './store.js';
import { persistCredentialsConfig } from './persistentCredentialStore.js';

const router = express.Router();
const PROVIDERS = ['crypto', 'forex', 'ninjatrader', 'polymarket'];
const SECRET_FIELDS = {
  crypto: ['apiKey', 'apiSecret', 'passphrase'],
  forex: ['accountId', 'apiKey', 'apiSecret', 'password'],
  ninjatrader: ['username', 'password', 'apiKey', 'apiSecret'],
  polymarket: ['apiKey', 'apiSecret', 'passphrase'],
};
router.use((req, res, next) => {
  const expected = process.env.INTEGRATION_SETTINGS_TOKEN;
  const supplied = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expected) return res.status(503).json({ error: 'Integration settings are locked until INTEGRATION_SETTINGS_TOKEN is configured on Render.' });
  const a = Buffer.from(supplied); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Integration settings access token is missing or invalid.' });
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache'); res.set('Expires', '0'); next();
});
router.get('/', (_req, res) => {
  const saved = store.getConfig('credentials', {})?.integrations || {};
  const result = {};
  for (const provider of PROVIDERS) {
    const entry = saved[provider] || {};
    const fields = {};
    for (const field of SECRET_FIELDS[provider]) {
      if (entry[field]?.encrypted) fields[field] = { configured: true, masked: entry[field].masked || 'Saved' };
    }
    result[provider] = { configured: Object.keys(fields).length > 0, fields, label: entry.label || null, savedAt: entry.savedAt || null };
  }
  res.json(result);
});
router.put('/:provider', async (req, res) => {
  const { provider } = req.params;
  if (!PROVIDERS.includes(provider)) return res.status(404).json({ error: 'Unknown integration provider.' });
  const body = req.body || {};
  try {
    const next = {};
    for (const field of SECRET_FIELDS[provider]) {
      const value = typeof body[field] === 'string' ? body[field].trim() : '';
      if (value) next[field] = { encrypted: encrypt(value), masked: maskSecret(value) };
    }
    if (!Object.keys(next).length && !String(body.label || '').trim()) return res.status(400).json({ error: 'Enter at least one credential field before saving.' });
    const credentials = store.getConfig('credentials', {});
    credentials.integrations = credentials.integrations || {};
    const previous = credentials.integrations[provider] || {};
    credentials.integrations[provider] = { ...previous, ...next, label: String(body.label || previous.label || '').trim().slice(0, 80), savedAt: new Date().toISOString() };
    await persistCredentialsConfig(credentials);
    res.json({ provider, configured: true, savedAt: credentials.integrations[provider].savedAt });
  } catch (error) { res.status(503).json({ error: error.message || 'Unable to save integration credentials.' }); }
});
router.delete('/:provider', async (req, res) => {
  const { provider } = req.params;
  if (!PROVIDERS.includes(provider)) return res.status(404).json({ error: 'Unknown integration provider.' });
  try {
    const credentials = store.getConfig('credentials', {});
    if (credentials.integrations) delete credentials.integrations[provider];
    await persistCredentialsConfig(credentials);
    res.json({ provider, configured: false });
  } catch (error) { res.status(503).json({ error: error.message || 'Unable to remove integration credentials.' }); }
});
export default router;
