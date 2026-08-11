const storedBase = typeof localStorage !== 'undefined' ? localStorage.getItem('momentumflow_api_url') : null;
const BASE = (import.meta.env.VITE_API_URL || storedBase || '/api').replace(/\/$/, '');
async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
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
  getTradingConfig: () => request('/trading-config'),
  setTradingConfig: (cfg) => request('/trading-config', {
    method: 'POST',
    body: JSON.stringify({
      startingCapital: Number(cfg.startingCapital),
      riskPerTrade: Number(cfg.riskPerTrade),
      maxTradesPerSession: Number(cfg.maxTradesPerSession),
      maxTradesPerMarket: Number(cfg.maxTradesPerMarket),
      winRateTarget: Number(cfg.winRateTarget),
      dailyLossLimit: Number(cfg.dailyLossLimit),
      consecutiveStopLoss: Number(cfg.consecutiveStopLoss),
    }),
  }),
  getLiveBotStatus: () => request('/live-bot/status'),
  startLiveBot: () => request('/live-bot/start', { method: 'POST' }),
  stopLiveBot: () => request('/live-bot/stop', { method: 'POST' }),
};
