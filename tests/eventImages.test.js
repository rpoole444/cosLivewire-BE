const assert = require('assert');
const {
  DEFAULT_EVENT_IMAGE_URL,
  attachEventImageFields,
  attachEventImageFieldsToMany,
  cleanImageUrl,
  isDefaultImage,
  isUsableImageValue,
  resolveEventImage,
} = require('../utils/eventImages');

assert.strictEqual(cleanImageUrl('  https://example.com/a.jpg  '), 'https://example.com/a.jpg');
assert.strictEqual(cleanImageUrl('none'), null);
assert.strictEqual(cleanImageUrl(undefined), null);

assert.strictEqual(isDefaultImage('https://example.com/alpine-groove-social-cover.png'), true);
assert.strictEqual(isDefaultImage('https://example.com/show-poster.png'), false);

assert.strictEqual(isUsableImageValue(''), false);
assert.strictEqual(isUsableImageValue('TBD'), false);
assert.strictEqual(isUsableImageValue('/images/event-placeholder.png'), false);
assert.strictEqual(isUsableImageValue('/images/event-placeholder.png', { allowDefault: true }), true);
assert.strictEqual(isUsableImageValue('https://example.com/poster.jpg'), true);
assert.strictEqual(isUsableImageValue('/uploads/poster.jpg'), true);

assert.deepStrictEqual(
  resolveEventImage({
    poster: 'https://example.com/show.jpg',
    venue_profile_image: 'https://example.com/venue.jpg',
  }),
  {
    display_image_url: 'https://example.com/show.jpg',
    display_image_source: 'event_poster',
    event_poster_status: 'valid',
  }
);

assert.deepStrictEqual(
  resolveEventImage({
    poster: null,
    venue_profile_image: 'https://example.com/venue.jpg',
  }),
  {
    display_image_url: 'https://example.com/venue.jpg',
    display_image_source: 'venue_profile_image',
    event_poster_status: 'missing',
  }
);

assert.deepStrictEqual(
  resolveEventImage({
    poster: '/images/event-placeholder.png',
    venue_profile_image: null,
  }),
  {
    display_image_url: DEFAULT_EVENT_IMAGE_URL,
    display_image_source: 'default',
    event_poster_status: 'default_or_invalid',
  }
);

assert.deepStrictEqual(
  resolveEventImage({
    poster: null,
    venue_profile_image: null,
    source_image_url: 'https://example.com/source.jpg',
  }),
  {
    display_image_url: 'https://example.com/source.jpg',
    display_image_source: 'source_image',
    event_poster_status: 'missing',
  }
);

const attached = attachEventImageFields({
  id: 1,
  poster: null,
  venue_profile_image: 'https://example.com/venue.jpg',
});
assert.strictEqual(attached.id, 1);
assert.strictEqual(attached.display_image_url, 'https://example.com/venue.jpg');
assert.strictEqual(attached.display_image_source, 'venue_profile_image');

const attachedMany = attachEventImageFieldsToMany([
  { id: 1, poster: 'https://example.com/show.jpg' },
  { id: 2, poster: null },
]);
assert.strictEqual(attachedMany.length, 2);
assert.strictEqual(attachedMany[0].display_image_source, 'event_poster');
assert.strictEqual(attachedMany[1].display_image_source, 'default');

console.log('eventImages tests passed.');
