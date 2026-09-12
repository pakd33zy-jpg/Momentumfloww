import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCryptoCandidateC62 } from './cryptoStrategyC62.js';

function bars({ leader = false } = {}) {
  const out = [];
  let value = 100;
  for (let i = 0; i < 140; i += 1) {
    const drift = i < 64 ? 0.03 : i < 128 ? 0.09 : leader ? 0.8 : 0.2;
    const open = value;
    value += drift;
    out.push({ t: new Date(Date.UTC(2026, 0, 1) + i * 900000).toISOString(), o: open, h: value + 0.08, l: open - 0.08, c: value });
  }
  return out;
}

test('C62 never trades BTC itself', () => {
  const result = evaluateCryptoCandidateC62({ asset: { symbol: 'BTC/USD' }, bars15m: bars(), btcBars15m: bars({ leader: true }), now: Date.UTC(2026, 0, 4) });
  assert.equal(result.signal, null);
});

test('C62 rejects incomplete history', () => {
  const result = evaluateCryptoCandidateC62({ asset: { symbol: 'ETH/USD' }, bars15m: [], btcBars15m: [], now: Date.UTC(2026, 0, 4) });
  assert.match(result.reason, /insufficient/);
});
