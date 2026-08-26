import express from 'express';

import { getCryptoBars } from './alpacaClient.js';

const router = express.Router();

const ALLOWED_SYMBOLS = new Set([
  'BTC/USD',
  'ETH/USD',
  'SOL/USD',
  'XRP/USD',
  'LINK/USD',
  'AVAX/USD',
  'LTC/USD',
  'BCH/USD',
  'DOGE/USD',
]);

const TIMEFRAMES = new Map([
  ['15Min', { maxDays: 365, maxPages: 5 }],
  ['1Hour', { maxDays: 730, maxPages: 5 }],
  ['1Day', { maxDays: 1825, maxPages: 2 }],
]);

function authorized(req) {
  const expected = String(process.env.RESEARCH_EXPORT_TOKEN || '');
  const supplied = String(req.get('x-research-token') || '');
  return expected.length >= 32 && supplied === expected;
}

router.get('/crypto-bars', async (req, res) => {
  if (!authorized(req)) {
    return res.status(404).json({ error: 'Not found.' });
  }

  try {
    const symbol = String(req.query.symbol || '').trim().toUpperCase();
    const timeframe = String(req.query.timeframe || '15Min');
    const timeframeConfig = TIMEFRAMES.get(timeframe);
    const requestedDays = Number(req.query.days || 180);

    if (!ALLOWED_SYMBOLS.has(symbol)) {
      return res.status(400).json({ error: 'Unsupported research symbol.' });
    }
    if (!timeframeConfig) {
      return res.status(400).json({ error: 'Unsupported research timeframe.' });
    }

    const days = Math.max(
      2,
      Math.min(timeframeConfig.maxDays, Math.floor(requestedDays || 180)),
    );
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const result = await getCryptoBars('paper', [symbol], {
      timeframe,
      start,
      end,
      limit: 10000,
      sort: 'asc',
      maxPages: timeframeConfig.maxPages,
    });
    const rows = result[symbol] || result[symbol.replace('/', '')] || [];

    res.set('Cache-Control', 'no-store');
    return res.json({
      symbol,
      timeframe,
      start: start.toISOString(),
      end: end.toISOString(),
      bars: rows,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
