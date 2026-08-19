import fs from 'fs';

const text = fs.readFileSync(
  new URL('./market.js', import.meta.url),
  'utf8'
);

function assert(value, message) {
  if (!value) throw new Error(message);
}

assert(text.includes('getCryptoBars'), 'getCryptoBars missing');
assert(text.includes("timeframe: '5Min'"), 'crypto 5Min history missing');
assert(text.includes("bars?.[symbol]"), 'crypto bar lookup missing');

console.log('crypto symbol chart regression test passed');
