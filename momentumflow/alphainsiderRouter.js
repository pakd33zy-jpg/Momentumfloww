import express from 'express';
import {
  ALLOWED_STRATEGY_TYPES,
  ALLOWED_RANKING_WINDOWS,
  searchAlphaInsiderPublicStrategies,
} from './alphainsiderStrategies.js';

const router = express.Router();
const cached = new Map();
const CACHE_MS = 10 * 60 * 1000;

// Returns only public strategy fields. Never exposes the AlphaInsider API key.
// Cache is bounded by 2 types * 3 timeframes, avoiding excessive API requests.
router.get('/shortlist', async (req, res) => {
  const type = String(req.query.type || 'cryptocurrency');
  const timeframe = String(req.query.timeframe || 'year');
  if (!ALLOWED_STRATEGY_TYPES.has(type) || !ALLOWED_RANKING_WINDOWS.has(timeframe))
    return res.status(400).json({ error: 'Unsupported type or timeframe.' });

  const cacheKey = type + ':' + timeframe;
  const existing = cached.get(cacheKey);
  if (existing && Date.now() - existing.timestamp < CACHE_MS) {
    res.set('Cache-Control', 'public, max-age=300');
    return res.json({ ...existing.value, cached: true });
  }

  const result = await searchAlphaInsiderPublicStrategies({ type, timeframe });
  if (!result.ok) {
    // Fixed enum statuses only; no upstream payload or credentials.
    return res.status(502).json({
      status: 'unavailable',
      reason: result.status,
      ...(Number.isInteger(result.httpStatus) ? { upstream_http_status: result.httpStatus } : {}),
    });
  }
  const value = { source: 'AlphaInsider', ...result, fetched_at: new Date().toISOString() };
  cached.set(cacheKey, { timestamp: Date.now(), value });
  res.set('Cache-Control', 'public, max-age=300');
  return res.json({ ...value, cached: false });
});

export default router;
