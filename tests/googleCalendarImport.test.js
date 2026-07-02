const assert = require('assert');
const {
  mapGoogleCalendarEvent,
  mapGoogleCalendarEvents,
} = require('../utils/googleCalendarImport');

const timed = mapGoogleCalendarEvent({
  id: 'abc123',
  summary: 'Scoop of Jazz',
  location: "Lulu's Downtown",
  description: 'A real show description.',
  htmlLink: 'https://calendar.google.com/event?eid=abc123',
  start: { dateTime: '2026-07-09T20:00:00-06:00' },
  end: { dateTime: '2026-07-09T22:00:00-06:00' },
  attachments: [
    { mimeType: 'image/png', fileUrl: 'https://example.com/poster.png' },
  ],
}, {
  calendarId: 'primary',
  calendarSummary: 'Band Calendar',
});

assert.strictEqual(timed.title, 'Scoop of Jazz');
assert.strictEqual(timed.venue_name, "Lulu's Downtown");
assert.strictEqual(timed.date, '2026-07-09');
assert.strictEqual(timed.start_time, '20:00:00');
assert.strictEqual(timed.end_time, '22:00:00');
assert.strictEqual(timed.poster, 'https://example.com/poster.png');
assert.strictEqual(timed.website_link, 'https://calendar.google.com/event?eid=abc123');
assert.strictEqual(timed.parse_warnings.length, 0);
assert(timed.fingerprint, 'expected stable fingerprint');

const allDay = mapGoogleCalendarEvent({
  id: 'all-day-1',
  summary: 'Festival hold',
  start: { date: '2026-08-01' },
  end: { date: '2026-08-02' },
}, {
  calendarId: 'primary',
});

assert.strictEqual(allDay.date, '2026-08-01');
assert.strictEqual(allDay.start_time, '00:00:00');
assert(allDay.parse_warnings.includes('all_day_event'));
assert(allDay.parse_warnings.includes('location_missing'));
assert(allDay.parse_warnings.includes('description_missing'));

const recurring = mapGoogleCalendarEvent({
  id: 'recurring-instance',
  recurringEventId: 'series-id',
  summary: 'Weekly Jam',
  location: 'The Venue',
  start: { dateTime: '2026-09-03T19:30:00-06:00' },
}, {});

assert(recurring.parse_warnings.includes('recurring_instance'));

const mapped = mapGoogleCalendarEvents([
  { summary: 'Missing date' },
  {
    id: 'good',
    summary: 'Good Event',
    location: 'Good Venue',
    start: { dateTime: '2026-10-01T19:00:00-06:00' },
  },
]);
assert.strictEqual(mapped.length, 1);
assert.strictEqual(mapped[0].title, 'Good Event');

console.log('googleCalendarImport tests passed.');
