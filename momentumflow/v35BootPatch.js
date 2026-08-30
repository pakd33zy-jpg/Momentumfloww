import fs from 'fs';

const path = new URL('./liveBotV35.js', import.meta.url);
let source = fs.readFileSync(path, 'utf8');

const perSymbol15m = `Promise.all(detailSymbols.map(async (symbol) =>
        getCryptoBars(mode, [symbol], {
          timeframe: '15Min',
          start: new Date(Date.now() - 14 * 24 * 60 * 60000),
          end: now,
          limit: 2000,
          maxPages: 2,
        })
      )).then((parts) => Object.assign({}, ...parts)),`;

const old15m = /getCryptoBars\(mode, detailSymbols, \{\s*timeframe: '15Min',\s*start: new Date\(Date\.now\(\) - 14 \* 24 \* 60 \* 60000\),\s*end: now,\s*limit: 10000,\s*\}\),/m;

if (old15m.test(source)) {
  source = source.replace(old15m, perSymbol15m);
  console.log('[boot-patch] V35 crypto 15m history fetch changed to per-symbol requests.');
} else if (source.includes("timeframe: '15Min'") && source.includes('getCryptoBars(mode, [symbol]')) {
  console.log('[boot-patch] V35 crypto 15m per-symbol fetch already present.');
} else {
  throw new Error('V35 15m fetch block not recognized; refusing to start with an unverified patch.');
}

const diagnosticNeedle = `      cryptoQualified: crypto.candidates.length,
      equityQualified: equity.candidates.length,`;
const diagnosticReplacement = `      cryptoQualified: crypto.candidates.length,
      equityQualified: equity.candidates.length,
      crypto15mCovered: Object.values(state.cryptoBarsCache.bars15m || {}).filter((rows) => Array.isArray(rows) && rows.length >= 24).length,
      crypto15mMissing: Math.max(0, state.universe.crypto.length - Object.values(state.cryptoBarsCache.bars15m || {}).filter((rows) => Array.isArray(rows) && rows.length >= 24).length),`;

if (!source.includes('crypto15mCovered:')) {
  if (!source.includes(diagnosticNeedle)) {
    throw new Error('V35 scan diagnostics block not recognized; refusing to start without coverage diagnostics.');
  }
  source = source.replace(diagnosticNeedle, diagnosticReplacement);
  console.log('[boot-patch] V35 crypto 15m coverage diagnostics added.');
}

fs.writeFileSync(path, source);
