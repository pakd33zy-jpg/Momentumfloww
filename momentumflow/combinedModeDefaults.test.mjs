import fs from 'node:fs';

const trading = fs.readFileSync(new URL('./tradingConfig.js', import.meta.url), 'utf8');
const equity = fs.readFileSync(new URL('./equityStrategyV20.js', import.meta.url), 'utf8');
const panel = fs.readFileSync(
  new URL('./frontend/src/components/EquityV20Panel.jsx', import.meta.url),
  'utf8',
);

if (!/TRADING_DEFAULTS\s*=\s*\{[\s\S]*?equityFocusMode:\s*false/.test(trading)) {
  throw new Error('trading defaults must keep combined crypto/equity mode enabled');
}

if (!/EQUITY_V20_DEFAULTS\s*=\s*\{[\s\S]*?equityFocusMode:\s*false/.test(equity)) {
  throw new Error('strategy defaults must not disable V33 crypto');
}

if (!/equityFocusMode:\s*false/.test(panel)) {
  throw new Error('settings UI must default Equity Focus off');
}

console.log('combined-mode default safety test passed');
