import express from 'express';
import { encrypt, maskSecret } from '../crypto.js';
import { store } from '../store.js';

const router = express.Router();

// GET /api/credentials — returns masked previews only, never plaintext or ciphertext
router.get('/', (req, res) => {
  const creds = store.getConfig('credentials', {});
  const result = {};
  for (const mode of ['paper', 'live']) {
    result[mode] = creds[mode]
      ? { configured: true, keyIdMasked: creds[mode].keyIdMasked, savedAt: creds[mode].savedAt }
      : { configured: false };
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
