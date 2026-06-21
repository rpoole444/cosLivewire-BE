const assert = require('assert');
const {
  jaccardSimilarity,
  normalizeComparableText,
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

console.log('eventDuplicateDetection tests passed.');
