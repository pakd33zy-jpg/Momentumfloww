import 'dotenv/config';
import { getTradableAssets, getCryptoBars } from './alpacaClient.js';

const mode = 'paper';
const assets = await getTradableAssets(mode);
const symbols = [...new Set((assets.crypto || []).map((asset) => asset.symbol).filter(Boolean))];
const end = new Date();
const start = new Date(Date.now() - 14 * 24 * 60 * 60000);
const counts = {};
const chunkSize = 6;

for (let i = 0; i < symbols.length; i += chunkSize) {
  const chunk = symbols.slice(i, i + chunkSize);
  const parts = await Promise.all(chunk.map(async (symbol) => {
    try {
      const rows = await getCryptoBars(mode, [symbol], {
        timeframe: '15Min',
        start,
        end,
        limit: 2000,
        maxPages: 2,
      });
      return [symbol, Array.isArray(rows?.[symbol]) ? rows[symbol].length : 0];
    } catch (error) {
      console.warn(`[v35-preflight] ${symbol} 15m fetch failed: ${error.message}`);
      return [symbol, 0];
    }
  }));
  for (const [symbol, count] of parts) counts[symbol] = count;
}

const covered = symbols.filter((symbol) => Number(counts[symbol] || 0) >= 24);
const missing = symbols.filter((symbol) => Number(counts[symbol] || 0) < 24);
console.log(`[v35-preflight] crypto 15m coverage ${covered.length}/${symbols.length}; missing=${missing.length}`);
if (missing.length) {
  console.log(`[v35-preflight] insufficient 15m history: ${missing.map((symbol) => `${symbol}(${counts[symbol] || 0})`).join(', ')}`);
}
