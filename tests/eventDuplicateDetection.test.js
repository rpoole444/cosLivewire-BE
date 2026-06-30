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
