import express from 'express';
import { encrypt, maskSecret } from './crypto.js';
import { store } from './store.js';
import { getAccountSummary, getCredentials } from './alpacaClient.js';

const router = express.Router();

// GET /api/credentials — returns masked/configured status only, never plaintext secrets
router.get('/', (req, res) => {
  const saved = store.getConfig('credentials', {});
  const result = {};
  for (const mode of ['paper', 'live']) {
    const effective = getCredentials(mode);
    const entry = saved[mode];
    result[mode] = effective
      ? {
          configured: true,
          source: effective.source || (entry ? 'saved' : 'environment'),
          keyIdMasked: entry?.keyIdMasked || maskSecret(effective.keyId),
          savedAt: entry?.savedAt || null,
        }
      : { configured: false };
  }
  res.json(result);
});

// GET /api/credentials/accounts — verifies Alpaca and returns current account values.
// The frontend polls this endpoint so LIVE dashboard values mirror Alpaca.
router.get('/accounts', async (req, res) => {
  const result = {};
  for (const mode of ['paper', 'live']) {
    if (!getCredentials(mode)) {
      result[mode] = { mode, connected: false, error: 'No credentials configured.' };
      continue;
    }
    try {
      result[mode] = await getAccountSummary(mode);
    } catch (err) {
      result[mode] = { mode, connected: false, error: err.message };
    }
  }
  res.json(result);
});

// POST /api/credentials — body: { mode: 'paper'|'live', keyId, secretKey }
router.post('/', (req, res) => {
  const { mode, keyId, secretKey } = req.body || {};
  if (!['paper', 'live'].includes(mode)) {
    return res.status(400).json({ error: "mode must be 'paper' or 'live'" });
  }
  if (!keyId || !secretKey) {
    return res.status(400).json({ error: 'keyId and secretKey are required' });
  }

  try {
    const creds = store.getConfig('credentials', {});
    creds[mode] = {
      keyIdEnc: encrypt(keyId),
      secretKeyEnc: encrypt(secretKey),
      keyIdMasked: maskSecret(keyId),
      savedAt: new Date().toISOString(),
    };
    store.setConfig('credentials', creds);
    res.json({ mode, configured: true, keyIdMasked: creds[mode].keyIdMasked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/credentials/:mode
router.delete('/:mode', (req, res) => {
  const { mode } = req.params;
  const creds = store.getConfig('credentials', {});
  delete creds[mode];
  store.setConfig('credentials', creds);
  res.json({ mode, configured: false });
});

export default router;
