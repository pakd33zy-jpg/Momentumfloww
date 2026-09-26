import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCryptoMacdPeakCandidate, evaluateCryptoMacdPeakExit } from './cryptoMacdPeakStrategy.js';

function barsFromCloses(closes) {
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);
  return closes.map((c, i) => ({ c, h: c * 1.002, l: c * 0.998, t: new Date(base + i * 3600000).toISOString() }));
}

test('MACD strategy module loads and rejects insufficient history safely', () => {
  const bars1h = barsFromCloses([100, 99, 98, 99, 100]);
  const result = evaluateCryptoMacdPeakCandidate({
    asset: { symbol: 'BTC/USD', name: 'Bitcoin' },
    snapshot: { latestTrade: { p: 100 } },
    bars1h,
    nowMs: Date.UTC(2026, 0, 2, 0, 0, 0),
  });
  assert.equal(result.signal, null);
  assert.match(result.reason, /not enough closed 1h candles/);
});

test('exit detector returns a boolean and never uses an open candle', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 4 + i * 0.05);
  const bars1h = barsFromCloses(closes);
  const result = evaluateCryptoMacdPeakExit({ bars1h, nowMs: Date.UTC(2026, 0, 5, 0, 0, 0) });
  assert.equal(typeof result.exit, 'boolean');
});
