// Public AlphaInsider strategy discovery only. This module never places orders.
// Documentation: https://api.alphainsider.com/resources/strategies/searchstrategies
const ENDPOINT = 'https://alphainsider.com/api/searchStrategies';
export const ALLOWED_STRATEGY_TYPES = new Set(['stock', 'cryptocurrency']);
export const ALLOWED_RANKING_WINDOWS = new Set(['month', 'year', 'five_year']);

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizePublicStrategy(strategy, timeframe) {
  if (!strategy || typeof strategy !== 'object') return null;
  const stats = Array.isArray(strategy.timeframes)
    ? strategy.timeframes.find((row) => row?.timeframe === timeframe)
    : null;
  if (typeof strategy.strategy_id !== 'string' || typeof strategy.name !== 'string') return null;
  return {
    strategy_id: strategy.strategy_id,
    name: strategy.name,
    type: strategy.type === 'stock' || strategy.type === 'cryptocurrency' ? strategy.type : null,
    created_at: typeof strategy.created_at === 'string' ? strategy.created_at : null,
    price: finiteNumber(strategy.price),
    subscribers: finiteNumber(strategy.subscriber_count),
    timeframe,
    rank_top: finiteNumber(stats?.rank_top),
    rank_performance: finiteNumber(stats?.rank_performance),
    max_drawdown_fraction: finiteNumber(stats?.max_drawdown),
    // Returns and risk-adjusted statistics must be independently computed from
    // the normalized performance history; do not mistake past_value for return.
  };
}

export async function searchAlphaInsiderPublicStrategies({
  type = 'cryptocurrency',
  timeframe = 'year',
  limit = 20,
  token = process.env.ALPHAINSIDER_API_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!ALLOWED_STRATEGY_TYPES.has(type) || !ALLOWED_RANKING_WINDOWS.has(timeframe))
    return { ok: false, status: 'invalid_filter' };
  if (typeof fetchImpl !== 'function') return { ok: false, status: 'fetch_unavailable' };
  const safeLimit = Math.max(1, Math.min(20, Math.trunc(Number(limit) || 20)));
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (token) headers.Authorization = token; // raw token, never logged.
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST', // documented SEARCH (read-only), not an order or mutation.
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        type: { includes: [type], excludes: [] },
        timeframe,
        sort: 'top',
        limit: safeLimit,
      }),
    });
    if (!response.ok)
      return { ok: false, status: 'http_error', httpStatus: response.status };
    const data = await response.json();
    if (data?.success !== true) return { ok: false, status: 'api_rejected' };
    if (!Array.isArray(data.response)) return { ok: false, status: 'malformed_response' };
    const strategies = data.response
      .slice(0, safeLimit)
      .map((item) => sanitizePublicStrategy(item, timeframe))
      .filter(Boolean);
    return { ok: true, status: 'ok', type, timeframe, strategies };
  } catch {
    // Never expose raw exception messages or upstream data.
    return { ok: false, status: 'connection_error' };
  }
}
