const assert = require('assert');
const dayjs = require('dayjs');
const {
  parseMoondogCalendar,
  buildFingerprint,
} = require('../utils/parseMoondogCalendar');

const currentYear = new Date().getFullYear();

const rawText = [
  'Thursday, Dec 11',
  'Tokki, Heavy Devils Trio, 6:30 p.m.',
  'Kinfolks, Ram Jam, 3 p.m., Eli Blackshear, 8:30 p.m.',
  'Buffalo Lodge, RV Casino, Annette & Doug Conlon, Co Spgs Pickers, 2 p.m.',
  'Cantina Verde, Matt Cravatta, 5 p.m',
  'Friday, Dec 12',
  'Moondog Lounge, TBA, 9 p.m.',
  'Whiskey Baron, Band A, Band B, 7 p.m.',
  'Bar One, 6 p.m.',
  'Club X, The Duo, 6 p.m. & 8 p.m.',
].join('\n');

const events = parseMoondogCalendar(rawText);

assert.strictEqual(events.length, 9, 'expected 9 parsed events');

const tokkiEvent = events[0];
assert.strictEqual(tokkiEvent.venue_name, 'Tokki');
assert.strictEqual(tokkiEvent.artist_display, 'Heavy Devils Trio');
assert.strictEqual(tokkiEvent.date, `${currentYear}-12-11`);
assert.strictEqual(tokkiEvent.start_time, '18:30:00');
assert.strictEqual(tokkiEvent.raw_block, 'Tokki, Heavy Devils Trio, 6:30 p.m.');

const kinfolksEvents = events.filter((event) => event.venue_name === 'Kinfolks');
assert.strictEqual(kinfolksEvents.length, 2);
assert.strictEqual(kinfolksEvents[0].artist_display, 'Ram Jam');
assert.strictEqual(kinfolksEvents[1].artist_display, 'Eli Blackshear');

const buffaloLodgeEvent = events.find((event) => event.venue_name === 'Buffalo Lodge');
assert.strictEqual(
  buffaloLodgeEvent.artist_display,
  'RV Casino, Annette & Doug Conlon, Co Spgs Pickers'
);
assert.ok(buffaloLodgeEvent.parse_warnings.includes('multiple_artists'));
assert.ok(buffaloLodgeEvent.date);
assert.ok(buffaloLodgeEvent.start_time);

const cantinaEvent = events.find((event) => event.venue_name === 'Cantina Verde');
assert.strictEqual(cantinaEvent.artist_display, 'Matt Cravatta');
assert.strictEqual(cantinaEvent.start_time, '17:00:00');

const multiArtistEvent = events.find((event) => event.venue_name === 'Whiskey Baron');
assert.ok(multiArtistEvent.parse_warnings.includes('multiple_artists'));

const missingArtistEvent = events.find((event) => event.venue_name === 'Bar One');
assert.strictEqual(missingArtistEvent.artist_display, 'TBA');
assert.ok(missingArtistEvent.parse_warnings.includes('artist_missing'));

const multiTimeEvent = events.find((event) => event.venue_name === 'Club X');
assert.ok(multiTimeEvent.parse_warnings.includes('multiple_times'));

const fingerprint = buildFingerprint({
  venue: tokkiEvent.venue_name,
  artist: tokkiEvent.artist_display,
  dateTime: dayjs(tokkiEvent.start_at).tz('America/Denver'),
});
assert.strictEqual(tokkiEvent.fingerprint, fingerprint);

console.log('parseMoondogCalendar tests passed');
