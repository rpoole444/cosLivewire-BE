const assert = require('assert');
const {
  canonicalVenueLookupName,
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
assert.strictEqual(venueNamesMatch("Lulu's Downtown", "Lulu's Downstairs"), true);
assert.strictEqual(canonicalVenueLookupName('The Can'), 'little man ice cream can');
assert.strictEqual(venueNamesMatch('The Can', 'Little Man Ice Cream Can'), true);
assert.strictEqual(venueNamesMatch('Little Man Ice Cream Factory Denver', 'Little Man Ice Cream'), true);
assert.strictEqual(canonicalVenueLookupName('Mill Hill Saloon'), 'mill hill saloon');
assert.strictEqual(venueNamesMatch('Can', 'Canyon Theater'), false);
assert.strictEqual(venueNamesMatch('Mission Ballroom', 'Dazzle'), false);
assert.strictEqual(venueNamesMatch('Boulder Theater', 'Boulder Cafe'), false);

console.log('venueProfiles tests passed.');
