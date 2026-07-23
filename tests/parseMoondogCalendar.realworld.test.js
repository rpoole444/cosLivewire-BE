const assert = require('assert');
const { parseMoondogCalendar } = require('../utils/parseMoondogCalendar');

const currentYear = new Date().getFullYear();

const rawText = [
  'Saturday, Nov 1',
  'Mill Hill Saloon, , 8:45 p.m.',
  "What's Left Records, 8 p.m.",
  'Anyplace, 1:30 p.m., 4:30 p.m.',
].join('\n');

const events = parseMoondogCalendar(rawText);

assert.strictEqual(events.length, 3, 'expected 3 parsed events');

const millHill = events[0];
assert.strictEqual(millHill.artist_display, 'TBA');
assert.ok(millHill.parse_warnings.includes('artist_missing'));
assert.ok(millHill.start_at instanceof Date);

const whatsLeft = events[1];
assert.strictEqual(whatsLeft.artist_display, 'TBA');
assert.ok(whatsLeft.parse_warnings.includes('artist_missing'));
assert.strictEqual(whatsLeft.date, `${currentYear}-11-01`);
assert.strictEqual(whatsLeft.start_time, '20:00:00');

const multiTime = events[2];
assert.strictEqual(multiTime.artist_display, 'TBA');
assert.ok(multiTime.parse_warnings.includes('multiple_times'));
assert.ok(multiTime.parse_warnings.includes('artist_missing'));
assert.strictEqual(multiTime.date, `${currentYear}-11-01`);
assert.strictEqual(multiTime.start_time, '13:30:00');

console.log('parseMoondogCalendar real-world tests passed');
