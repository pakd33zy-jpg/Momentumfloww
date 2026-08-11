const storedBase = typeof localStorage !== 'undefined' ? localStorage.getItem('momentumflow_api_url') : null;
const BASE = (import.meta.env.VITE_API_URL || storedBase || '/api').replace(/\/$/, '');
const CONFIG_CACHE_KEY = 'momentumflow_trading_config_v3';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

function readCachedConfig() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CONFIG_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCachedConfig(config, { dirty = false, updatedAt } = {}) {
  if (typeof localStorage === 'undefined') return config;
  const record = {
    config: { ...config },
    dirty,
    updatedAt: updatedAt || config?.updatedAt || new Date().toISOString(),
  };
  try { localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(record)); } catch {}
  return record.config;
}

function canonicalConfig(cfg = {}) {
  return {
    startingCapital: Number(cfg.startingCapital),
    riskPerTrade: Number(cfg.riskPerTrade),
    maxTradesPerSession: Number(cfg.maxTradesPerSession),
    maxTradesPerMarket: Number(cfg.maxTradesPerMarket),
    winRateTarget: Number(cfg.winRateTarget),
    dailyLossLimit: Number(cfg.dailyLossLimit),
    consecutiveStopLoss: Number(cfg.consecutiveStopLoss),
  };
}

async function getTradingConfig() {
  let remote = null;
  try {
    remote = await request('/trading-config');
  } catch (err) {
    const cached = readCachedConfig();
    if (cached?.config) return cached.config;
    throw err;
  }

  const cached = readCachedConfig();
  if (!cached?.config) {
    writeCachedConfig(remote, { dirty: false, updatedAt: remote.updatedAt });
    return remote;
  }

  const localTime = Date.parse(cached.updatedAt || 0) || 0;
  const remoteTime = Date.parse(remote.updatedAt || 0) || 0;

  // If the browser copy is newer (including unsaved draft edits), keep it and sync it
  // back to Railway. This prevents a backend restart/default file from resetting the UI.
  if (cached.dirty || localTime > remoteTime) {
    const localConfig = canonicalConfig(cached.config);
    try {
      const saved = await request('/trading-config', {
        method: 'POST',
        body: JSON.stringify(localConfig),
      });
      writeCachedConfig(saved, { dirty: false, updatedAt: saved.updatedAt });
      return saved;
    } catch {
      return cached.config;
    }
  }

  writeCachedConfig(remote, { dirty: false, updatedAt: remote.updatedAt });
  return remote;
}

function cacheTradingConfigDraft(cfg) {
  writeCachedConfig(cfg, { dirty: true, updatedAt: new Date().toISOString() });
  return cfg;
}

async function setTradingConfig(cfg) {
  const payload = canonicalConfig(cfg);
  // Store locally first so a failed request can never bounce the inputs back to presets.
  writeCachedConfig(payload, { dirty: true, updatedAt: new Date().toISOString() });
  const saved = await request('/trading-config', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  writeCachedConfig(saved, { dirty: false, updatedAt: saved.updatedAt });
  return saved;
}

export const api = {
  listSessions: () => request('/sessions'),
  getSession: (id) => request(`/sessions/${id}`),
  getSessionTrades: (id) => request(`/sessions/${id}/trades`),
  runPaperSession: () => request('/sessions/paper/run', { method: 'POST', body: JSON.stringify({}) }),
  getPaperAccount: () => request('/sessions/paper/account'),
  resetPaperAccount: (startingCapital) => request('/sessions/paper/reset', { method: 'POST', body: JSON.stringify({ startingCapital }) }),
  placeLiveTrade: (payload) => request('/sessions/live/trade', { method: 'POST', body: JSON.stringify(payload) }),
  haltSession: (id, reason) => request(`/sessions/${id}/halt`, { method: 'POST', body: JSON.stringify({ reason }) }),
  getTradingMode: () => request('/trading-mode'),
  setTradingMode: (mode) => request('/trading-mode', { method: 'POST', body: JSON.stringify({ mode }) }),
  getLiveGate: () => request('/live-gate'),
  setLiveGateItem: (item, value) => request('/live-gate', { method: 'POST', body: JSON.stringify({ item, value }) }),
  resetLiveGate: () => request('/live-gate/reset', { method: 'POST' }),
  getCredentials: () => request('/credentials'),
  getBrokerAccounts: () => request('/credentials/accounts'),
  saveCredentials: (mode, keyId, secretKey) => request('/credentials', { method: 'POST', body: JSON.stringify({ mode, keyId, secretKey }) }),
  deleteCredentials: (mode) => request(`/credentials/${mode}`, { method: 'DELETE' }),
  getMarketGrid: () => request('/market/grid'),
  sendCommand: (text) => request('/chat/command', { method: 'POST', body: JSON.stringify({ text }) }),
  getTradingConfig,
  cacheTradingConfigDraft,
  setTradingConfig,
  getLiveBotStatus: () => request('/live-bot/status'),
  startLiveBot: () => request('/live-bot/start', { method: 'POST' }),
  stopLiveBot: () => request('/live-bot/stop', { method: 'POST' }),
};
