import fs from 'fs';
const text = fs.readFileSync(
  new URL('./liveBot.js', import.meta.url),
  'utf8'
);

function assert(value, message) {
  if (!value) throw new Error(message);
}

assert(
  text.includes("paperExtendedEquityEnabled: true"),
  'paper extended-hours flag missing'
);

assert(
  text.includes("mode === 'paper'"),
  'PAPER-only guard missing'
);

assert(
  text.includes("? 'limit'") &&
  text.includes("extendedHours:"),
  'extended-hours limit order path missing'
);

assert(
  text.includes("'overnight'"),
  'overnight session/feed support missing'
);

console.log('overnight PAPER safety test passed');
