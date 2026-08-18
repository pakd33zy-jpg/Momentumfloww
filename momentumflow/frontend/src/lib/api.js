const storedBase =
  typeof localStorage !== 'undefined'
    ? localStorage.getItem('momentumflow_api_url')
    : null;

const BASE = (
  import.meta.env.VITE_API_URL ||
  storedBase ||
  '/api'
).replace(/\/$/, '');

const CONFIG_DRAFT_KEY = 'momentumflow_trading_config_draft';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      data.error ||
      data.message ||
      `Request failed: ${res.status}`
    );
  }

  return data;
}

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

  try {
    localStorage.setItem(
      CONFIG_DRAFT_KEY,
      JSON.stringify(draft)
    );
  } catch {
    // Ignore browser storage errors.
  }
}

function clearTradingConfigDraft() {
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.removeItem(CONFIG_DRAFT_KEY);
  } catch {
    // Ignore browser storage errors.
  }
}

export const api = {
  // Sessions
  listSessions: () => request('/sessions'),

  getSession: (id) =>
    request(`/sessions/${id}`),

  getSessionTrades: (id) =>
    request(`/sessions/${id}/trades`),

  // Paper account
  runPaperSession: () =>
    request('/sessions/paper/run', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  getPaperAccount: () =>
    request('/sessions/paper/account'),

  resetPaperAccount: (startingCapital) =>
    request('/sessions/paper/reset', {
      method: 'POST',
      body: JSON.stringify({
        startingCapital: Number(startingCapital),
      }),
    }),

  // Manual live order
  placeLiveTrade: (payload) =>
    request('/sessions/live/trade', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  haltSession: (id, reason) =>
    request(`/sessions/${id}/halt`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  // Trading mode
  getTradingMode: () =>
    request('/trading-mode'),

  setTradingMode: (mode) =>
    request('/trading-mode', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),

  // Live gate
  getLiveGate: () =>
    request('/live-gate'),

  setLiveGateItem: (item, value) =>
    request('/live-gate', {
      method: 'POST',
      body: JSON.stringify({
        item,
        value,
      }),
    }),

  resetLiveGate: () =>
    request('/live-gate/reset', {
      method: 'POST',
    }),

  // Alpaca credentials
  getCredentials: () =>
    request('/credentials'),

  // IMPORTANT:
  // This verifies the actual Alpaca accounts.
  getBrokerAccounts: () =>
    request('/credentials/accounts'),

  saveCredentials: (mode, keyId, secretKey) =>
    request('/credentials', {
      method: 'POST',
      body: JSON.stringify({
        mode,
        keyId,
        secretKey,
      }),
    }),

  deleteCredentials: (mode) =>
    request(`/credentials/${mode}`, {
      method: 'DELETE',
    }),

  // Market data
  getMarketGrid: () =>
    request('/market/grid'),

  getMarketVolatility: () =>
    request('/market/volatility'),

  getSymbolDetail: (symbol) =>
    request(`/market/symbol/${encodeURIComponent(symbol)}`),

  placeManualOrder: (payload) =>
    request('/market/manual-order', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Chat
  sendCommand: (text) =>
    request('/chat/command', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  // Trading configuration
  getTradingConfig: () =>
    request('/trading-config'),

  // IMPORTANT:
  // Send the ENTIRE configuration object.
  // The old version only sent startingCapital.
  setTradingConfig: (cfg) =>
    request('/trading-config', {
      method: 'POST',
      body: JSON.stringify(cfg),
    }),

  // Browser draft helpers
  readTradingConfigDraft,
  writeTradingConfigDraft,
  clearTradingConfigDraft,

  // Automated trading bot
  getLiveBotStatus: () =>
    request('/live-bot/status'),

  getRejectionLog: (limit = 100) =>
    request(
      `/live-bot/rejection-log?limit=${encodeURIComponent(limit)}`
    ),

  clearRejectionLog: () =>
    request('/live-bot/rejection-log', {
      method: 'DELETE',
    }),

  startLiveBot: () =>
    request('/live-bot/start', {
      method: 'POST',
    }),

  stopLiveBot: () =>
    request('/live-bot/stop', {
      method: 'POST',
    }),
};
