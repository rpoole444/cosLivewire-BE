const crypto = require('crypto');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

const DAY_HEADER_REGEX = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+([A-Za-z]+)\s+(\d{1,2})/i;
const TIME_REGEX = /(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/gi;
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
    'MMM D YYYY',
    'MMMM D YYYY',
  ];

  let parsed = null;
  for (const format of formats) {
    const candidate = dayjs(`${monthText} ${dayText} ${baseYear}`, format, true);
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

  const localDateTime = dayjs.tz(
    `${date.format('YYYY-MM-DD')} ${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`,
    'YYYY-MM-DD HH:mm',
    'America/Denver'
  );
  const startAt = localDateTime.utc();

  const fingerprint = buildFingerprint({
    venue,
    artist: resolvedArtist,
    dateTime: dayjs(startAt).tz('America/Denver'),
  });

  return {
    venue_name: venue,
    artist_display: resolvedArtist,
    start_at: startAt.toDate(),
    date: localDateTime.format('YYYY-MM-DD'),
    start_time: localDateTime.format('HH:mm:ss'),
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
  const pendingArtists = [];
  const pendingTimes = [];

  const hasArtistToken = segments.some((segment) => {
    const artistPart = segment
      .replace(TIME_REGEX, '')
      .replace(/[&]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return artistPart && normalizeText(artistPart) !== 'tba';
  });

  if (!hasArtistToken) {
    const warnings = ['artist_missing'];
    if (lineTimes.length > 1) warnings.push('multiple_times');
    events.push(buildEvent({
      venue,
      artistDisplay: '',
      time: lineTimes[0],
      date,
      rawBlock: line,
      warnings,
    }));
    debugLog(`[parser] venue="${venue}"`);
    debugLog(`[parser] pairs=${JSON.stringify([{ artist: 'TBA', time: lineTimes[0] }])}`);
    debugLog(`[parser] events_created=${events.length}`);
    return events;
  }

  // Sequential parsing: build events only when an artist-time pair completes.
  const flushPending = () => {
    if (pendingTimes.length === 0) return;

    if (pendingArtists.length === 0) {
      const warnings = ['artist_missing'];
      if (pendingTimes.length > 1) warnings.push('multiple_times');
      events.push(buildEvent({
        venue,
        artistDisplay: '',
        time: pendingTimes[0],
        date,
        rawBlock: line,
        warnings,
      }));
      return;
    }

    if (pendingArtists.length === 1) {
      const warnings = [];
      if (pendingTimes.length > 1) warnings.push('multiple_times');
      events.push(buildEvent({
        venue,
        artistDisplay: pendingArtists[0],
        time: pendingTimes[0],
        date,
        rawBlock: line,
        warnings,
      }));
      return;
    }

    if (pendingTimes.length === 1) {
      events.push(buildEvent({
        venue,
        artistDisplay: pendingArtists.join(', '),
        time: pendingTimes[0],
        date,
        rawBlock: line,
        warnings: ['multiple_artists'],
      }));
      return;
    }

    const pairCount = Math.min(pendingArtists.length, pendingTimes.length);
    for (let i = 0; i < pairCount; i += 1) {
      events.push(buildEvent({
        venue,
        artistDisplay: pendingArtists[i],
        time: pendingTimes[i],
        date,
        rawBlock: line,
        warnings: ['multiple_artists'],
      }));
    }
  };

  segments.forEach((segment) => {
    const segmentTimes = extractTimes(segment);
    const normalized = segment
      .replace(TIME_REGEX, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(?:&\s*)+$/, '');
    const isTba = normalized && normalizeText(normalized) === 'tba';
    const hasArtist = normalized && !isTba;

    if (segmentTimes.length === 0) {
      if (hasArtist) {
        if (pendingTimes.length > 0) {
          flushPending();
          pendingTimes.length = 0;
          pendingArtists.length = 0;
        }
        pendingArtists.push(normalized);
      }
      return;
    }

    if (hasArtist) {
      if (pendingTimes.length > 0) {
        flushPending();
        pendingTimes.length = 0;
        pendingArtists.length = 0;
      }
      pendingArtists.push(normalized);
    }

    pendingTimes.push(...segmentTimes);
  });

  flushPending();

  debugLog(`[parser] venue="${venue}"`);
  debugLog(`[parser] pairs=${JSON.stringify(
    events.map((event) => ({
      artist: event.artist_display,
      time: `${event.start_at.getHours()}:${String(event.start_at.getMinutes()).padStart(2, '0')}`,
    }))
  )}`);
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
