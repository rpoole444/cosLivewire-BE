const assert = require('assert');
const {
  normalizeVenueLookupName,
  venueNamesMatch,
} = require('../utils/venueProfiles');

assert.strictEqual(normalizeVenueLookupName('Red Rocks Park & Amphitheatre'), 'red rocks');
assert.strictEqual(normalizeVenueLookupName('Red Rocks Amphitheater'), 'red rocks');

assert.strictEqual(venueNamesMatch('Red Rocks', 'Red Rocks Park & Amphitheatre'), true);
assert.strictEqual(venueNamesMatch('Red Rocks Amphitheatre', 'Red Rocks Park & Amphitheatre'), true);
assert.strictEqual(venueNamesMatch('Red Rocks Park & Amphitheater', 'Red Rocks'), true);
assert.strictEqual(venueNamesMatch('The Black Sheep Colorado', 'The Black Sheep'), true);
assert.strictEqual(venueNamesMatch("Louie Louie's", "Louie Louie's Piano Bar"), true);
assert.strictEqual(venueNamesMatch('Mill Hill Saloon', "Bloom's Mill Hill Saloon"), true);
assert.strictEqual(venueNamesMatch("Lulu's", "Lulu's Downstairs"), true);
assert.strictEqual(venueNamesMatch('Mission Ballroom', 'Dazzle'), false);

console.log('venueProfiles tests passed.');
