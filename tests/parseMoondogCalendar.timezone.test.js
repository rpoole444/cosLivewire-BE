const assert = require('assert');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { parseMoondogCalendar } = require('../utils/parseMoondogCalendar');

dayjs.extend(utc);
dayjs.extend(timezone);

const rawText = [
  'Saturday, Nov 1',
  'Venue X, Artist Y, 7 p.m.',
].join('\n');

const events = parseMoondogCalendar(rawText);
const event = events[0];

assert.strictEqual(
  dayjs(event.start_at).tz('America/Denver').format('HH:mm'),
  '19:00'
);

console.log('parseMoondogCalendar timezone tests passed');
