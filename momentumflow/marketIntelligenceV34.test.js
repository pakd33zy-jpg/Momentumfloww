import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyNewsArticleV34,
  scoreNewsIntelligenceV34,
  mergeIntelligenceV34,
} from './marketIntelligenceV34.js';

const now = new Date('2026-08-26T10:00:00Z');

function article(headline, symbols = ['ABC'], hoursAgo = 0.5, id = headline) {
  return {
    id,
    headline,
    summary: '',
    symbols,
    created_at: new Date(now.getTime() - hoursAgo * 3600000).toISOString(),
  };
}

test('large government contract is a strong fresh positive catalyst', () => {
  const event = classifyNewsArticleV34(
    article('ABC awarded $2.4 billion Department of Defense contract'),
    now,
  );
  assert.ok(event);
  assert.ok(event.types.includes('GOVERNMENT_CONTRACT'));
  assert.ok(event.impact >= 3.5);
});

test('old catalysts decay instead of staying permanently bullish', () => {
  const fresh = classifyNewsArticleV34(
    article('ABC wins federal government contract', ['ABC'], 1),
    now,
  );
  const old = classifyNewsArticleV34(
    article('ABC wins federal government contract', ['ABC'], 60),
    now,
  );
  assert.ok(fresh.impact > old.impact);
});

test('dilution and bankruptcy are negative intelligence', () => {
  const result = scoreNewsIntelligenceV34({
    symbol: 'ABC',
    now,
    articles: [
      article('ABC announces $300 million public offering', ['ABC'], 0.5, 1),
      article('ABC warns of possible debt default and going concern', ['ABC'], 0.5, 2),
    ],
  });
  assert.ok(result.netScore < 0);
  assert.ok(result.bearishScore > 0);
  assert.equal(result.score, 0);
});

test('major customer and approval catalysts combine without duplicate headline explosion', () => {
  const a = article('ABC signs multi-year supply agreement with major customer', ['ABC'], 0.5, 10);
  const b = article('ABC receives regulatory approval for new product', ['ABC'], 0.5, 11);
  const duplicate = { ...a };
  const result = scoreNewsIntelligenceV34({
    symbol: 'ABC',
    articles: [a, duplicate, b],
    now,
  });
  assert.equal(result.eventCount, 2);
  assert.ok(result.netScore > 2.5);
  assert.ok(result.reasons.length >= 2);
});

test('symbol association prevents unrelated news from contaminating a candidate', () => {
  const result = scoreNewsIntelligenceV34({
    symbol: 'ABC',
    now,
    articles: [
      article('XYZ awarded huge government contract', ['XYZ'], 0.5),
    ],
  });
  assert.equal(result.eventCount, 0);
  assert.equal(result.netScore, 0);
});

test('supporting intelligence merges but remains bounded', () => {
  const merged = mergeIntelligenceV34(
    { netScore: 7, reasons: ['government award'] },
    { netScore: 6, reasons: ['insider accumulation'] },
  );
  assert.equal(merged.netScore, 10);
  assert.equal(merged.score, 10);
  assert.deepEqual(merged.reasons, ['government award', 'insider accumulation']);
});

test('negative evidence can offset positive headlines', () => {
  const merged = mergeIntelligenceV34(
    { netScore: 5, reasons: ['contract win'] },
    { netScore: -7, reasons: ['guidance cut'] },
  );
  assert.equal(merged.netScore, -2);
  assert.equal(merged.score, 0);
  assert.equal(merged.bearishScore, 4);
});
