import pg from 'pg';
import { store } from './store.js';

const { Pool } = pg;
let pool = null;
let initialized = false;
let loadedSavedCredentials = false;
let writeTested = false;

// Use Render's DATABASE_URL environment variable. Never commit a database URL,
// encrypted or otherwise, to source control. Existing database rows are left intact.
function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not configured on the Render service.');
    }
    pool = new Pool({
      connectionString,
      max: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
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

export async function initPersistentCredentials({ retries = 3, delayMs = 1500 } = {}) {
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
        // Do not overwrite or delete any existing database records.
        store.setConfig('credentials', {});
        loadedSavedCredentials = false;
      }
      initialized = true;
      console.log(`[credentials] Persistent store ready; saved credentials loaded=${loadedSavedCredentials}`);
      return { ready: true, loaded: loadedSavedCredentials };
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  initialized = false;
  loadedSavedCredentials = false;
  writeTested = false;
  console.error('[credentials] Persistent store initialization failed:', lastError?.message);
  return { ready: false, loaded: false, error: lastError?.message || 'Unknown persistence error' };
}

export function persistentCredentialStoreReady() { return initialized; }
export function persistentCredentialStoreConfigured() { return Boolean(process.env.DATABASE_URL); }
export function persistentCredentialWriteTested() { return initialized && writeTested; }
export function hasPersistedCredentials() { return initialized && loadedSavedCredentials; }

export async function loadPersistentConfig(configKey, fallback = {}) {
  if (!initialized) {
    const result = await initPersistentCredentials({ retries: 1, delayMs: 500 });
    if (!result.ready) return { found: false, value: fallback };
  }
  const result = await getPool().query(
    'SELECT config_value FROM momentumflow_secure_config WHERE config_key = $1',
    [String(configKey)]
  );
  const value = result.rows?.[0]?.config_value;
  if (value == null) return { found: false, value: fallback };
  store.setConfig(String(configKey), value);
  return { found: true, value };
}

export async function persistConfig(configKey, value) {
  if (!initialized) {
    const result = await initPersistentCredentials({ retries: 1, delayMs: 500 });
    if (!result.ready) throw new Error('Persistent config store is unavailable. Configure DATABASE_URL on Render.');
  }
  await getPool().query(
    `INSERT INTO momentumflow_secure_config (config_key, config_value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (config_key)
     DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
    [String(configKey), JSON.stringify(value ?? {})]
  );
  store.setConfig(String(configKey), value ?? {});
  return true;
}

export async function persistCredentialsConfig(credentials) {
  if (!initialized) {
    const result = await initPersistentCredentials({ retries: 1, delayMs: 500 });
    if (!result.ready) throw new Error('Persistent credential store is unavailable. Configure DATABASE_URL on Render.');
  }
  await getPool().query(
    `INSERT INTO momentumflow_secure_config (config_key, config_value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (config_key)
     DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
    ['credentials', JSON.stringify(credentials || {})]
  );
  store.setConfig('credentials', credentials || {});
  loadedSavedCredentials = Boolean(
    credentials?.paper?.keyIdEnc ||
    credentials?.live?.keyIdEnc ||
    Object.values(credentials?.integrations || {}).some((entry) => entry && Object.keys(entry).length)
  );
  return true;
}
