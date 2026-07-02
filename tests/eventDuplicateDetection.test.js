const assert = require('assert');
const {
  findDuplicateCandidates,
  jaccardSimilarity,
  normalizeComparableText,
  normalizeDate,
  scorePotentialDuplicate,
} = require('../utils/eventDuplicateDetection');

assert.strictEqual(
  normalizeComparableText('Poole & The Gang'),
  'poole and gang'
);

assert(jaccardSimilarity('Poole and the Gang', 'Poole & Gang') >= 0.75);

const likely = scorePotentialDuplicate(
  {
    title: 'Poole and the Gang',
    artist_display: 'Poole and the Gang',
    venue_name: 'Lulus Downtown',
    date: '2026-07-09',
    start_time: '20:00:00',
  },
  {
    title: 'Poole & The Gang',
    venue_name: "Lulu's Downtown",
    date: '2026-07-09',
    start_time: '20:00:00',
  }
);

assert(likely, 'expected likely duplicate match');
assert.strictEqual(likely.level, 'likely');

const differentlyNamedSameShow = scorePotentialDuplicate(
  {
    title: 'Scoop Of Jazz with Poole & the Gang',
    artist_display: 'Scoop Of Jazz with Poole & the Gang',
    venue_name: 'The Mining Exchange Hotel',
    date: '2026-07-09',
    start_time: '19:00:00',
  },
  {
    title: 'Mining Exchange with Poole and the Gang',
    venue_name: null,
    venue_profile_display_name: 'Mining Exchange',
    location: '8 S Nevada Ave, Colorado Springs, CO',
    date: '2026-07-09',
    start_time: '19:00:00',
  }
);

assert(differentlyNamedSameShow, 'expected venue/time match to catch rephrased duplicate');
assert.strictEqual(differentlyNamedSameShow.level, 'likely');
assert.strictEqual(differentlyNamedSameShow.reason, 'same_venue_date_time_related_title');

const sameVenueTimeUnrelatedTitle = scorePotentialDuplicate(
  {
    title: 'Open Mic Night',
    artist_display: 'Open Mic Night',
    venue_name: 'Mining Exchange',
    date: '2026-07-09',
    start_time: '19:00:00',
  },
  {
    title: 'Classical Brunch',
    venue_profile_display_name: 'The Mining Exchange Hotel',
    date: '2026-07-09',
    start_time: '19:00:00',
  }
);

assert(sameVenueTimeUnrelatedTitle, 'expected exact same venue/time to be visible as possible duplicate');
assert.strictEqual(sameVenueTimeUnrelatedTitle.level, 'possible');

const differentDate = scorePotentialDuplicate(
  {
    title: 'Poole and the Gang',
    venue_name: 'Lulus Downtown',
    date: '2026-07-09',
    start_time: '20:00:00',
  },
  {
    title: 'Poole & The Gang',
    venue_name: "Lulu's Downtown",
    date: '2026-07-10',
    start_time: '20:00:00',
  }
);

assert.strictEqual(differentDate, null);

assert.strictEqual(normalizeDate(new Date('not-a-date')), null);
assert.strictEqual(normalizeDate('not-a-date'), null);
assert.strictEqual(normalizeDate('2026-07-01T00:00:00.000Z'), '2026-07-01');

(async () => {
  const emptyDuplicateResults = await findDuplicateCandidates(
    () => {
      throw new Error('duplicate lookup should not run without valid dates');
    },
    [
      {
        title: 'Bad staged import row',
        venue_name: 'Vultures',
        date: new Date('not-a-date'),
        start_time: '20:00:00',
      },
    ]
  );

  assert.strictEqual(emptyDuplicateResults.size, 0);
  console.log('eventDuplicateDetection tests passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
