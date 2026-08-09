const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

export const api = {
  // Sessions
  listSessions: () => request('/sessions'),
  getSession: (id) => request(`/sessions/${id}`),
  getSessionTrades: (id) => request(`/sessions/${id}/trades`),
  runPaperSession: (startingCapital) =>
    request('/sessions/paper/run', { method: 'POST', body: JSON.stringify({ startingCapital }) }),
  placeLiveTrade: (payload) =>
    request('/sessions/live/trade', { method: 'POST', body: JSON.stringify(payload) }),
  haltSession: (id, reason) =>
    request(`/sessions/${id}/halt`, { method: 'POST', body: JSON.stringify({ reason }) }),

  // Trading mode
  getTradingMode: () => request('/trading-mode'),
  setTradingMode: (mode) => request('/trading-mode', { method: 'POST', body: JSON.stringify({ mode }) }),

  // Live Gate
  getLiveGate: () => request('/live-gate'),
  setLiveGateItem: (item, value) =>
    request('/live-gate', { method: 'POST', body: JSON.stringify({ item, value }) }),
  resetLiveGate: () => request('/live-gate/reset', { method: 'POST' }),

  // Credentials
  getCredentials: () => request('/credentials'),
  saveCredentials: (mode, keyId, secretKey) =>
    request('/credentials', { method: 'POST', body: JSON.stringify({ mode, keyId, secretKey }) }),
  deleteCredentials: (mode) => request(`/credentials/${mode}`, { method: 'DELETE' }),

  // Market
  getMarketGrid: () => request('/market/grid'),

  // Chat
  sendCommand: (text) => request('/chat/command', { method: 'POST', body: JSON.stringify({ text }) }),
};
