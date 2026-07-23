const assert = require('assert');
const { parseGenreSelection } = require('../utils/profileInput');

assert.deepStrictEqual(parseGenreSelection([' Jazz ', 'Funk', 'Soul', 'Rock']), ['Jazz', 'Funk', 'Soul']);
assert.deepStrictEqual(parseGenreSelection('["Jazz","Funk"]'), ['Jazz', 'Funk']);
assert.deepStrictEqual(parseGenreSelection(undefined), []);
assert.strictEqual(parseGenreSelection('{bad json'), null);
assert.strictEqual(parseGenreSelection('{"genre":"Jazz"}'), null);

console.log('profileInput tests passed');
