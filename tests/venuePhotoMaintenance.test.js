const assert = require('assert');
const {
  classifyImageValue,
  filenameToVenueHint,
  normalizeVenueCandidateName,
  scoreVenuePhotoMatch,
} = require('../utils/venuePhotoMaintenance');

assert.strictEqual(
  normalizeVenueCandidateName('The Black Sheep Colorado Springs'),
  'the black sheep'
);

assert.strictEqual(
  filenameToVenueHint('/Users/reidpoole/Downloads/Black Sheep Logo.jpg'),
  'the black sheep'
);

const blackSheepMatch = scoreVenuePhotoMatch(
  '/Users/reidpoole/Downloads/Black Sheep Logo.jpg',
  { id: 10, display_name: 'The Black Sheep' }
);
assert.ok(blackSheepMatch);
assert.strictEqual(blackSheepMatch.confidence, 'high');

const boulderMatch = scoreVenuePhotoMatch(
  '/Users/reidpoole/Downloads/Boulder Theater Logo.webp',
  { id: 11, display_name: 'Boulder Theater' }
);
assert.ok(boulderMatch);
assert.strictEqual(boulderMatch.confidence, 'high');

const noMatch = scoreVenuePhotoMatch(
  '/Users/reidpoole/Downloads/Boulder Theater Logo.webp',
  { id: 12, display_name: 'Dazzle' }
);
assert.strictEqual(noMatch, null);

assert.deepStrictEqual(
  classifyImageValue(null),
  { status: 'missing', repairable: true, reason: 'empty_or_placeholder_text' }
);

assert.deepStrictEqual(
  classifyImageValue('TBD'),
  { status: 'missing', repairable: true, reason: 'empty_or_placeholder_text' }
);

assert.deepStrictEqual(
  classifyImageValue('/images/event-placeholder.png'),
  { status: 'default', repairable: true, reason: 'default_alpine_image' }
);

assert.deepStrictEqual(
  classifyImageValue('not a url'),
  { status: 'possibly_broken', repairable: true, reason: 'not_url_or_public_path' }
);

assert.deepStrictEqual(
  classifyImageValue('https://example.com/poster.jpg'),
  { status: 'set', repairable: false, reason: 'image_value_present' }
);

console.log('venuePhotoMaintenance tests passed.');
