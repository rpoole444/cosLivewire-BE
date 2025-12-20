const crypto = require('crypto');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');

dayjs.extend(customParseFormat);

const DAY_HEADER_REGEX = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+([A-Za-z]+)\s+(\d{1,2})/i;
const TIME_REGEX = /(\d{1,2})(?::(\d{2}))?\s*(a\.m\.|p\.m\.|am|pm)\b/gi;
const DEBUG_PARSER = process.env.DEBUG_PARSER === 'true';

const debugLog = (message) => {
  if (DEBUG_PARSER) {
    console.log(message);
  }
};

const normalizeText = (value) => {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
};

const normalizeForFingerprint = (value) => {
  return normalizeText(value)
    .normalize('NFKD')
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\p{Diacritic}/gu, '');
};

const parseDayHeader = (line, referenceYear) => {
  const match = line.match(DAY_HEADER_REGEX);
  if (!match) return null;

  const monthText = match[2];
  const dayText = match[3];
  const baseYear = referenceYear || new Date().getFullYear();

  const formats = [
    'dddd, MMM D YYYY',
    'dddd, MMMM D YYYY',
    'ddd, MMM D YYYY',
    'ddd, MMMM D YYYY',
  ];

  let parsed = null;
  for (const format of formats) {
    const candidate = dayjs(`${match[1]}, ${monthText} ${dayText} ${baseYear}`, format, true);
    if (candidate.isValid()) {
      parsed = candidate;
      break;
    }
  }

  if (!parsed) return null;

  const today = dayjs();
  if (parsed.isBefore(today.subtract(6, 'month'))) {
    parsed = parsed.add(1, 'year');
  }

  return parsed.startOf('day');
};

const extractTimes = (segment) => {
  const times = [];
  const text = String(segment || '');
  let match;

  TIME_REGEX.lastIndex = 0;
  while ((match = TIME_REGEX.exec(text)) !== null) {
    const hour = parseInt(match[1], 10);
    const minute = match[2] ? parseInt(match[2], 10) : 0;
    const meridiem = match[3].toLowerCase();

    if (Number.isNaN(hour) || Number.isNaN(minute)) continue;

    let normalizedHour = hour % 12;
    if (meridiem.startsWith('p')) {
      normalizedHour += 12;
    }

    times.push({ hour: normalizedHour, minute });
  }

  return times;
};

const roundToQuarterHour = (dateTime) => {
  const base = dayjs(dateTime);
  const totalMinutes = base.hour() * 60 + base.minute();
  const roundedTotal = Math.round(totalMinutes / 15) * 15;
  const delta = roundedTotal - totalMinutes;
  return base.add(delta, 'minute').second(0).millisecond(0);
};

const buildFingerprint = ({ venue, artist, dateTime }) => {
  const rounded = roundToQuarterHour(dateTime);
  const fingerprintSource = [
    normalizeForFingerprint(venue),
    normalizeForFingerprint(artist),
    rounded.format('YYYY-MM-DD'),
    rounded.format('HH:mm'),
  ].join('|');

  return crypto.createHash('sha256').update(fingerprintSource).digest('hex');
};

const buildEvent = ({ venue, artistDisplay, time, date, rawBlock, warnings }) => {
  const resolvedWarnings = Array.isArray(warnings) ? [...warnings] : [];
  let resolvedArtist = artistDisplay;

  if (!resolvedArtist) {
    if (!resolvedWarnings.includes('artist_missing')) {
      resolvedWarnings.push('artist_missing');
    }
    resolvedArtist = 'TBA';
  }

  const startAt = date
    .hour(time.hour)
    .minute(time.minute)
    .second(0)
    .millisecond(0);

  const fingerprint = buildFingerprint({
    venue,
    artist: resolvedArtist,
    dateTime: startAt,
  });

  return {
    venue_name: venue,
    artist_display: resolvedArtist,
    start_at: startAt.toDate(),
    raw_block: rawBlock,
    parse_warnings: resolvedWarnings,
    fingerprint,
  };
};

const parseVenueLine = (line, date) => {
  debugLog(`[parser] line="${line}"`);

  const lineTimes = extractTimes(line);
  if (!line.includes(',') || lineTimes.length === 0) {
    debugLog('[parser] events_created=0');
    return [];
  }

  const segments = line.split(',').map((segment) => segment.trim()).filter(Boolean);
  if (!segments.length) return [];

  const venue = segments.shift();
  const events = [];
  let pendingArtist = null;
  const pendingArtists = [];

  // Sequential parsing: build events only when an artist-time pair completes.
  segments.forEach((segment) => {
    const segmentTimes = extractTimes(segment);
    const normalized = segment
      .replace(TIME_REGEX, '')
      .replace(/[&]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const isTba = normalized && normalizeText(normalized) === 'tba';

    if (segmentTimes.length === 0) {
      if (normalized && !isTba) {
        pendingArtists.push(normalized);
        pendingArtist = normalized;
      }
      return;
    }

    const warnings = [];
    const time = segmentTimes[0];
    if (segmentTimes.length > 1) {
      warnings.push('multiple_times');
    }

    if (pendingArtists.length === 0) {
      warnings.push('artist_missing');
      events.push(buildEvent({
        venue,
        artistDisplay: '',
        time,
        date,
        rawBlock: line,
        warnings,
      }));
      pendingArtist = null;
      return;
    }

    if (pendingArtists.length > 1) {
      warnings.push('multiple_artists');
    }

    events.push(buildEvent({
      venue,
      artistDisplay: pendingArtists.join(', '),
      time,
      date,
      rawBlock: line,
      warnings,
    }));

    pendingArtists.length = 0;
    pendingArtist = null;
  });

  debugLog(`[parser] venue="${venue}"`);
  debugLog(`[parser] events_created=${events.length}`);
  return events;
};

const parseMoondogCalendar = (rawText) => {
  if (!rawText || typeof rawText !== 'string') return [];

  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const parsedEvents = [];
  let currentDate = null;

  lines.forEach((line) => {
    const headerDate = parseDayHeader(line);
    if (headerDate) {
      currentDate = headerDate;
      return;
    }

    if (!currentDate) return;

    const cleanedLine = line.replace(/^[-*]\s+/, '');
    parsedEvents.push(...parseVenueLine(cleanedLine, currentDate));
  });

  return parsedEvents;
};

module.exports = {
  parseMoondogCalendar,
  parseDayHeader,
  parseVenueLine,
  extractTimes,
  roundToQuarterHour,
  buildFingerprint,
};
