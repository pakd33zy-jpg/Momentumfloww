import crypto from 'crypto';
import pg from 'pg';
import { store } from './store.js';

const { Pool } = pg;

// The database URL is encrypted before being committed. The decryption key is
// derived from a server-side seed already present in Render; plaintext
// connection credentials never live in the repository.
const ENCRYPTED_DATABASE_URL =
  'N2MXZhowbXjTKJwP.3+2PjUFTT4W++qEPZDpXpA==.98hoC9hdLOLxBnd1m49qOanTlc4TjLpcc6Sd9gUOUhohGq3m+bWp3kZdvXwUd567JCKIe8rx/GyMXkIRdePDdMNzWA6UmMnrl+cOK3SfEziOGhBwnhwxp5wO6UNvquzjZug=';

let pool = null;
let initialized = false;
let loadedSavedCredentials = false;
let writeTested = false;

function persistenceSeed() {
  const seed =
    process.env.CREDENTIAL_PERSISTENCE_SEED ||
    process.env.ALPACA_PAPER_SECRET_KEY ||
    process.env.ALPACA_SECRET_KEY ||
    process.env.ALPACA_LIVE_SECRET_KEY;

  if (!seed) {
    throw new Error('No server-side persistence seed is configured.');
  }
  return String(seed);
}

function decryptDatabaseUrl() {
  const key = crypto
    .createHash('sha256')
    .update(`momentumflow-persistence-db:v1:${persistenceSeed()}`, 'utf8')
    .digest();

  const [ivB64, tagB64, ciphertextB64] = ENCRYPTED_DATABASE_URL.split('.');
  if (!ivB64 || !tagB64 || !ciphertextB64) {
    throw new Error('Malformed encrypted database URL.');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: decryptDatabaseUrl(),
      max: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return pool;
}

async function ensureTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS momentumflow_secure_config (
      config_key TEXT PRIMARY KEY,
      config_value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function initPersistentCredentials({ retries = 20, delayMs = 2500 } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await ensureTable();
      await getPool().query(
        `INSERT INTO momentumflow_secure_config (config_key, config_value, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (config_key)
         DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
        ['__persistence_selftest__', JSON.stringify({ ok: true, at: new Date().toISOString() })]
      );
      const selfTest = await getPool().query(
        'SELECT config_value FROM momentumflow_secure_config WHERE config_key = $1',
        ['__persistence_selftest__']
      );
      writeTested = selfTest.rows?.[0]?.config_value?.ok === true;
      await getPool().query(
        'DELETE FROM momentumflow_secure_config WHERE config_key = $1',
        ['__persistence_selftest__']
      );

      const result = await getPool().query(
        'SELECT config_value FROM momentumflow_secure_config WHERE config_key = $1',
        ['credentials']
      );
      const saved = result.rows?.[0]?.config_value || null;
      if (saved && typeof saved === 'object') {
        store.setConfig('credentials', saved);
        loadedSavedCredentials = true;
      } else {
        store.setConfig('credentials', {});
        loadedSavedCredentials = false;
      }
      initialized = true;
      console.log(
        `[credentials] Persistent credential store ready; saved credentials loaded=${loadedSavedCredentials}`
      );
      return { ready: true, loaded: loadedSavedCredentials };
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  initialized = false;
  loadedSavedCredentials = false;
  writeTested = false;
  console.error('[credentials] Persistent store initialization failed:', lastError?.message);
  return { ready: false, loaded: false, error: lastError?.message || 'Unknown persistence error' };
}

export function persistentCredentialStoreReady() {
  return initialized;
}

export function persistentCredentialStoreConfigured() {
  return Boolean(
    process.env.CREDENTIAL_PERSISTENCE_SEED ||
    process.env.ALPACA_PAPER_SECRET_KEY ||
    process.env.ALPACA_SECRET_KEY ||
    process.env.ALPACA_LIVE_SECRET_KEY
  );
}

export function persistentCredentialWriteTested() {
  return initialized && writeTested;
}

export function hasPersistedCredentials() {
  return initialized && loadedSavedCredentials;
}

export async function persistCredentialsConfig(credentials) {
  if (!initialized) {
    const result = await initPersistentCredentials({ retries: 3, delayMs: 1000 });
    if (!result.ready) throw new Error('Persistent credential store is unavailable.');
  }

  await getPool().query(
    `
      INSERT INTO momentumflow_secure_config (config_key, config_value, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (config_key)
      DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()
    `,
    ['credentials', JSON.stringify(credentials || {})]
  );

  store.setConfig('credentials', credentials || {});
  loadedSavedCredentials = Boolean(
    credentials?.paper?.keyIdEnc ||
    credentials?.live?.keyIdEnc
  );
  return true;
}
