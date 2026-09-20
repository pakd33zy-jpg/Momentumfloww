import fs from 'node:fs';
import path from 'node:path';
import { buildPersistentBreakoutTrades, tradeStats as cryptoStats } from './causalCryptoEngine.mjs';
import { buildScoredEquityTrades, tradeStats as equityStats } from './causalEquityEngine.mjs';

const [,, market, inputPath, outputPath] = process.argv;
if (!['crypto', 'equity'].includes(market) || !inputPath) {
  throw new Error('usage: node research/runHistoricalValidation.mjs <crypto|equity> <input.json> [output.json]');
}
const series = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const rows = [];
for (const [symbol, bars] of Object.entries(series)) {
  const result = market === 'crypto' ? buildPersistentBreakoutTrades(bars) : buildScoredEquityTrades(bars);
  const stats = market === 'crypto' ? cryptoStats(result.trades) : equityStats(result.trades);
  rows.push({ symbol, ...stats });
}
const aggregate = {
  market,
  generatedAt: new Date().toISOString(),
  symbols: rows.length,
  closedTrades: rows.reduce((n, r) => n + r.closedTrades, 0),
  netReturnPoints: rows.reduce((n, r) => n + r.netReturnPoints, 0),
  results: rows,
};
const json = JSON.stringify(aggregate, null, 2) + '\n';
if (outputPath) fs.writeFileSync(path.resolve(outputPath), json);
else process.stdout.write(json);
