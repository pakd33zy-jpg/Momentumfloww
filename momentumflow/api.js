const storedBase = typeof localStorage !== 'undefined' ? localStorage.getItem('momentumflow_api_url') : null;
const BASE = (import.meta.env.VITE_API_URL || storedBase || '/api').replace(/\/$/, '');
const CONFIG_CACHE_KEY = 'momentumflow_trading_config_v4';

const CONFIG_DEFAULTS = {
  startingCapital: 100,
  riskPerTrade: 0.02,
  maxTradesPerSession: 24,
  maxTradesPerMarket: 12,
  winRateTarget: 0.875,
  dailyLossLimit: 0.10,
  consecutiveStopLoss: 3,
};

function normalizeConfig(cfg = {}) {
  return {
    startingCapital: Number(cfg.startingCapital ?? CONFIG_DEFAULTS.startingCapital),
    riskPerTrade: Number(cfg.riskPerTrade ?? CONFIG_DEFAULTS.riskPerTrade),
    maxTradesPerSession: Number(cfg.maxTradesPerSession ?? cfg.tradesPerSession ?? CONFIG_DEFAULTS.maxTradesPerSession),
    maxTradesPerMarket: Number(cfg.maxTradesPerMarket ?? cfg.tradesPerMarket ?? CONFIG_DEFAULTS.maxTradesPerMarket),
    winRateTarget: Number(cfg.winRateTarget ?? CONFIG_DEFAULTS.winRateTarget),
    dailyLossLimit: Number(cfg.dailyLossLimit ?? CONFIG_DEFAULTS.dailyLossLimit),
    consecutiveStopLoss: Number(cfg.consecutiveStopLoss ?? CONFIG_DEFAULTS.consecutiveStopLoss),
    ...(cfg.updatedAt ? { updatedAt: cfg.updatedAt } : {}),
  };
}

function readTradingConfigCache() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CONFIG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.config ? parsed : null;
  } catch {
    return null;
  }
}

function writeTradingConfigCache(config, status = 'draft') {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({
      config: { ...config },
      status,
      savedAt: status === 'saved' ? new Date().toISOString() : null,
      editedAt: new Date().toISOString(),
    }));
  } catch {}
}

function cacheTradingConfigDraft(config) {
  // Deliberately store the raw input strings too. This prevents "250" from being replaced
  // by a server/default value merely because the user clicked into another field.
  writeTradingConfigCache(config, 'draft');
  return config;
}

async function getTradingConfig() {
  const cached = readTradingConfigCache();

  // If there is any browser draft/saved copy, it is the UI source of truth on this device.
  // We still fetch the server copy for first-run/no-cache cases only.
  if (cached?.config) return cached.config;

  const remote = normalizeConfig(await request('/trading-config'));
  writeTradingConfigCache(remote, 'saved');
  return remote;
}

async function getServerTradingConfig() {
  return normalizeConfig(await request('/trading-config'));
}

async function setTradingConfig(cfg) {
  const payload = normalizeConfig(cfg);

  // Keep the local draft BEFORE the network request. If Railway rejects/fails,
  // the user's typed values remain visible and are not replaced by presets.
  writeTradingConfigCache(cfg, 'draft');

  const saved = normalizeConfig(await request('/trading-config', {
    method: 'POST',
    body: JSON.stringify(payload),
  }));
  writeTradingConfigCache(saved, 'saved');
  return saved;
}

function clearTradingConfigCache() {
  if (typeof localStorage !== 'undefined') {
    try { localStorage.removeItem(CONFIG_CACHE_KEY); } catch {}
  }
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
  getServerTradingConfig,
  cacheTradingConfigDraft,
  setTradingConfig,
  clearTradingConfigCache,
  getLiveBotStatus: () => request('/live-bot/status'),
  startLiveBot: () => request('/live-bot/start', { method: 'POST' }),
  stopLiveBot: () => request('/live-bot/stop', { method: 'POST' }),
};
