const assert = require('assert');
const { shouldUseLegacyOwnerFallback } = require('../utils/profileEventPolicy');

assert.strictEqual(shouldUseLegacyOwnerFallback({ profileType: 'artist', activeArtistProfileCount: 1 }), true);
assert.strictEqual(shouldUseLegacyOwnerFallback({ profileType: null, activeArtistProfileCount: 1 }), true);
assert.strictEqual(shouldUseLegacyOwnerFallback({ profileType: 'artist', activeArtistProfileCount: 2 }), false);
assert.strictEqual(shouldUseLegacyOwnerFallback({ profileType: 'venue', activeArtistProfileCount: 1 }), false);
assert.strictEqual(shouldUseLegacyOwnerFallback({ profileType: 'promoter', activeArtistProfileCount: 1 }), false);

console.log('profileEventPolicy tests passed');
