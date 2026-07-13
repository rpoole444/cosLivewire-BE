const assert = require('assert');
const {
  calculateEventHealthScore,
  parseWarningsField,
  suggestVenueMatches,
} = require('../utils/dataQualityService');

const completeEvent = {
  id: 1,
  title: 'Poole and the Gang at Lulu\'s',
  date: '2026-07-12',
  start_time: '19:00:00',
  venue_profile_id: 10,
  venue_name: "Lulu's Downstairs",
  region: 'colorado-springs',
  poster: 'https://example.com/poster.jpg',
  artist_profile_id: 20,
  description: 'A full live music event with enough detail for fans to understand the show.',
  website: 'https://example.com',
  source: 'manual',
};

const thinEvent = {
  id: 2,
  title: 'Show',
  date: 'not-a-date',
  start_time: '',
  venue_name: 'TBD',
  poster: '',
  description: 'TBD',
};

assert(calculateEventHealthScore(completeEvent).score > calculateEventHealthScore(thinEvent).score);
assert(calculateEventHealthScore(completeEvent).checks.every((check) => typeof check.ok === 'boolean'));

assert.deepStrictEqual(parseWarningsField('["duplicate_possible","missing_region"]'), ['duplicate_possible', 'missing_region']);
assert.deepStrictEqual(parseWarningsField('duplicate_possible\nmissing_region'), ['duplicate_possible', 'missing_region']);

const suggestions = suggestVenueMatches(
  { venue_name: 'Mill Hill Saloon', region: 'colorado-springs' },
  [
    { id: 1, display_name: "Bloom's Mill Hill Saloon", slug: 'blooms-mill-hill-saloon', home_region: 'colorado-springs', aliases: [] },
    { id: 2, display_name: 'Mission Ballroom', slug: 'mission-ballroom', home_region: 'denver', aliases: [] },
  ]
);

assert.strictEqual(suggestions[0].payload.venue_profile_id, 1);
assert(suggestions[0].score >= 0.58);

console.log('dataQualityService tests passed.');
