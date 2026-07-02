const crypto = require('crypto');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { buildFingerprint } = require('./parseMoondogCalendar');

dayjs.extend(utc);
dayjs.extend(timezone);

const DENVER_TZ = 'America/Denver';

const normalizeText = (value) => String(value || '').trim().replace(/\s+/g, ' ');

const buildGoogleCalendarFingerprint = ({ calendarId, googleEventId, venue, title, startAt }) => {
  const source = [
    'google_calendar',
    normalizeText(calendarId),
    normalizeText(googleEventId),
    normalizeText(venue),
    normalizeText(title),
    startAt ? dayjs(startAt).tz(DENVER_TZ).format('YYYY-MM-DD HH:mm') : '',
  ].join('|');

  return crypto.createHash('sha256').update(source).digest('hex');
};

const parseGoogleDateTime = (dateValue) => {
  if (!dateValue) return null;
  if (dateValue.dateTime) {
    const parsed = dayjs(dateValue.dateTime);
    return parsed.isValid() ? parsed.tz(DENVER_TZ) : null;
  }
  if (dateValue.date) {
    const parsed = dayjs.tz(`${dateValue.date} 00:00`, 'YYYY-MM-DD HH:mm', DENVER_TZ);
    return parsed.isValid() ? parsed : null;
  }
  return null;
};

const findGoogleEventImage = (event = {}) => {
  const attachments = Array.isArray(event.attachments) ? event.attachments : [];
  const imageAttachment = attachments.find((attachment) => {
    const mime = String(attachment.mimeType || '').toLowerCase();
    return mime.startsWith('image/') && attachment.fileUrl;
  });
  return imageAttachment?.fileUrl || null;
};

const mapGoogleCalendarEvent = (event = {}, { calendarId, calendarSummary, defaults = {} } = {}) => {
  const start = parseGoogleDateTime(event.start);
  if (!start) return null;

  const end = parseGoogleDateTime(event.end);
  const isAllDay = Boolean(event.start?.date && !event.start?.dateTime);
  const title = normalizeText(event.summary) || 'Untitled Google Calendar event';
  const venueName = normalizeText(defaults.venue_name || event.location);
  const location = normalizeText(event.location || defaults.location || defaults.venue_name);
  const description = normalizeText(event.description);
  const htmlLink = normalizeText(event.htmlLink);
  const poster = findGoogleEventImage(event);
  const warnings = [];

  if (!event.location && !defaults.venue_name) warnings.push('location_missing');
  if (!description) warnings.push('description_missing');
  if (isAllDay) warnings.push('all_day_event');
  if (event.recurringEventId) warnings.push('recurring_instance');

  const fingerprint = event.id
    ? buildGoogleCalendarFingerprint({
        calendarId,
        googleEventId: event.id,
        venue: venueName || location,
        title,
        startAt: start,
      })
    : buildFingerprint({
        venue: venueName || location || 'Google Calendar',
        artist: title,
        dateTime: start,
      });

  return {
    google_event_id: event.id || null,
    google_calendar_id: calendarId || null,
    calendar_summary: calendarSummary || null,
    title,
    artist_display: defaults.artist_display || title,
    venue_name: venueName || null,
    location: location || venueName || null,
    description: description || null,
    website: htmlLink || null,
    website_link: htmlLink || null,
    poster,
    start_at: start.utc().toDate(),
    date: start.format('YYYY-MM-DD'),
    start_time: start.format('HH:mm:ss'),
    end_time: end && end.isValid() ? end.tz(DENVER_TZ).format('HH:mm:ss') : null,
    raw_block: JSON.stringify({
      id: event.id || null,
      calendarId: calendarId || null,
      calendarSummary: calendarSummary || null,
      summary: event.summary || null,
      location: event.location || null,
      htmlLink: event.htmlLink || null,
    }),
    parse_warnings: warnings,
    fingerprint,
  };
};

const mapGoogleCalendarEvents = (events = [], options = {}) => (
  events.map((event) => mapGoogleCalendarEvent(event, options)).filter(Boolean)
);

module.exports = {
  buildGoogleCalendarFingerprint,
  mapGoogleCalendarEvent,
  mapGoogleCalendarEvents,
  parseGoogleDateTime,
};
