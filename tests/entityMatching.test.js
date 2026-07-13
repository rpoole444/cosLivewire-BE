const assert = require('assert');
const {
  confidenceFromScore,
  normalizeEntityName,
  sameCityOrUnknown,
  sameRegionOrUnknown,
  tokenSimilarity,
} = require('../utils/entityMatching');

assert.strictEqual(normalizeEntityName("Louie Louie's Piano Bar"), 'louie louies piano bar');
assert.strictEqual(
  normalizeEntityName("Louie Louie's Piano Bar", { removeVenueSuffixes: true }),
  'louie louies'
);
assert.strictEqual(normalizeEntityName('Boulder Theatre'), 'boulder theater');

assert(tokenSimilarity("Bloom's Mill Hill Saloon", 'Mill Hill Saloon', { removeVenueSuffixes: true }) > 0.7);
assert(tokenSimilarity('Mission Ballroom', 'Dazzle') < 0.3);

assert.strictEqual(confidenceFromScore(1), 'exact');
assert.strictEqual(confidenceFromScore(0.88), 'high');
assert.strictEqual(confidenceFromScore(0.72), 'medium');
assert.strictEqual(confidenceFromScore(0.5), 'low');

assert.strictEqual(sameRegionOrUnknown('denver', 'denver'), true);
assert.strictEqual(sameRegionOrUnknown(null, 'denver'), true);
assert.strictEqual(sameRegionOrUnknown('denver', 'boulder'), false);

assert.strictEqual(sameCityOrUnknown('Colorado Springs', 'colorado springs'), true);
assert.strictEqual(sameCityOrUnknown('', 'Denver'), true);
assert.strictEqual(sameCityOrUnknown('Denver', 'Boulder'), false);

console.log('entityMatching tests passed.');
