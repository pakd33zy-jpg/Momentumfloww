import fs from 'fs';

const text = fs.readFileSync(
  new URL('./liveBot.js', import.meta.url),
  'utf8'
);

function assert(value, message) {
  if (!value) throw new Error(message);
}

assert(
  /c\.stockFeed\s*=\s*['"]boats['"]\s*;/.test(text),
  'historical overnight BOATS feed missing'
);

assert(
  !/c\.stockFeed\s*=\s*['"]overnight['"]\s*;/.test(text),
  'invalid historical feed=overnight still present'
);

assert(
  text.includes("mode === 'paper'"),
  'PAPER-only extended-hours guard missing'
);

console.log('overnight historical feed safety test passed');
