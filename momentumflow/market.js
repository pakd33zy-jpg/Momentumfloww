import express from 'express';
import { getMarketGrid } from '../alpacaClient.js';
import { MARKETS } from '../models.js';

const router = express.Router();

router.get('/grid', async (req, res) => {
  try {
    const all = [...MARKETS.crypto, ...MARKETS.equity];
    const grid = await getMarketGrid(all);
    res.json(grid);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
