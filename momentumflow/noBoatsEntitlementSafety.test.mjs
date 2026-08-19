import fs from 'fs';
const t = fs.readFileSync(new URL('./liveBot.js', import.meta.url), 'utf8');
if (/c\.stockFeed\s*=\s*['"]boats['"]/.test(t)) throw new Error('BOATS query still enabled');
if (!t.includes("state.equitySession !== 'overnight'")) throw new Error('overnight equity skip missing');
if (!t.includes("mode === 'paper'")) throw new Error('paper guard missing');
console.log('no-BOATS entitlement safety test passed');
