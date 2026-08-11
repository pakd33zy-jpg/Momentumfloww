const storedBase = typeof localStorage !== 'undefined' ? localStorage.getItem('momentumflow_api_url') : null;
const BASE = (import.meta.env.VITE_API_URL || storedBase || '/api').replace(/\/$/, '');
const CONFIG_DRAFT_KEY = 'momentumflow_trading_config_draft_v5';

function readTradingConfigDraft() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CONFIG_DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeTradingConfigDraft(draft) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(CONFIG_DRAFT_KEY, JSON.stringify(draft)); } catch {}
}

function clearTradingConfigDraft() {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(CONFIG_DRAFT_KEY); } catch {}
}

async function getTradingConfig() {
  return request('/trading-config');
}

async function setTradingConfig(cfg) {
  return request('/trading-config', {
    method: 'POST',
    body: JSON.stringify(cfg),
  });
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
  readTradingConfigDraft,
  writeTradingConfigDraft,
  clearTradingConfigDraft,
  setTradingConfig,
  getLiveBotStatus: () => request('/live-bot/status'),
  startLiveBot: () => request('/live-bot/start', { method: 'POST' }),
  stopLiveBot: () => request('/live-bot/stop', { method: 'POST' }),
};
