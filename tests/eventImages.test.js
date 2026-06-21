const assert = require('assert');
const {
  DEFAULT_EVENT_IMAGE_URL,
  isUsableImageValue,
  resolveEventImage,
} = require('../utils/eventImages');

assert.strictEqual(isUsableImageValue(''), false);
assert.strictEqual(isUsableImageValue('TBD'), false);
assert.strictEqual(isUsableImageValue('/images/event-placeholder.png'), false);
assert.strictEqual(isUsableImageValue('https://example.com/poster.jpg'), true);

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

console.log('eventImages tests passed.');
