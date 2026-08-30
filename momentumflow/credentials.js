import express from 'express';
import { encrypt, maskSecret } from './crypto.js';
import { store } from './store.js';
import { getAccountSummary, getCredentials } from './alpacaClient.js';

const router = express.Router();

// Credential status changes immediately after a save/remove. Never let a browser
// or intermediary reuse an old configured/connection response.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

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
// The frontend polls this endpoint so dashboard values mirror Alpaca.
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
// Save first, then immediately verify against Alpaca so the UI can distinguish
// "saved" from "saved but Alpaca rejected the pair" instead of appearing broken.
router.post('/', async (req, res) => {
  const { mode, keyId, secretKey } = req.body || {};
  if (!['paper', 'live'].includes(mode)) {
    return res.status(400).json({ error: "mode must be 'paper' or 'live'" });
  }

  const cleanKeyId = String(keyId || '').trim();
  const cleanSecretKey = String(secretKey || '').trim();
  if (!cleanKeyId || !cleanSecretKey) {
    return res.status(400).json({ error: 'keyId and secretKey are required' });
  }

  try {
    const creds = store.getConfig('credentials', {});
    creds[mode] = {
      keyIdEnc: encrypt(cleanKeyId),
      secretKeyEnc: encrypt(cleanSecretKey),
      keyIdMasked: maskSecret(cleanKeyId),
      savedAt: new Date().toISOString(),
    };
    store.setConfig('credentials', creds);

    try {
      const account = await getAccountSummary(mode);
      return res.json({
        mode,
        configured: true,
        verified: account?.connected === true,
        connected: account?.connected === true,
        keyIdMasked: creds[mode].keyIdMasked,
        savedAt: creds[mode].savedAt,
        account: {
          connected: account?.connected === true,
          equity: account?.equity ?? null,
          status: account?.status ?? null,
        },
      });
    } catch (verifyErr) {
      return res.json({
        mode,
        configured: true,
        verified: false,
        connected: false,
        keyIdMasked: creds[mode].keyIdMasked,
        savedAt: creds[mode].savedAt,
        verificationError: verifyErr?.message || 'Alpaca rejected the saved credentials.',
      });
    }
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
