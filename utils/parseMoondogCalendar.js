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
  const pendingArtists = [];
  const pairs = [];

  segments.forEach((segment) => {
    const segmentTimes = extractTimes(segment);
    const artistPart = segment
      .replace(TIME_REGEX, '')
      .replace(/[&]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const artistIsTba = artistPart && normalizeText(artistPart) === 'tba';
    const hasArtist = artistPart && !artistIsTba;

    if (segmentTimes.length === 0) {
      if (hasArtist) {
        pendingArtists.push(artistPart);
      }
      return;
    }

    if (hasArtist) {
      pendingArtists.push(artistPart);
    }

    pairs.push({
      artists: pendingArtists.length ? [...pendingArtists] : [],
      times: segmentTimes,
    });

    pendingArtists.length = 0;
  });

  const pairLog = pairs.map((pair) => ({
    artists: pair.artists,
    times: pair.times.map((time) => `${time.hour}:${String(time.minute).padStart(2, '0')}`),
  }));
  debugLog(`[parser] venue="${venue}"`);
  debugLog(`[parser] pairs=${JSON.stringify(pairLog)}`);

  pairs.forEach((pair) => {
    const artists = pair.artists;
    const times = pair.times;

    if (artists.length === 0) {
      events.push(buildEvent({
        venue,
        artistDisplay: '',
        time: times[0],
        date,
        rawBlock: line,
        warnings: ['artist_missing'],
      }));
      return;
    }

    if (artists.length === 1 && times.length > 1) {
      events.push(buildEvent({
        venue,
        artistDisplay: artists[0],
        time: times[0],
        date,
        rawBlock: line,
        warnings: ['multiple_times'],
      }));
      return;
    }

    if (artists.length > 1 && times.length === 1) {
      events.push(buildEvent({
        venue,
        artistDisplay: artists.join(', '),
        time: times[0],
        date,
        rawBlock: line,
        warnings: ['multiple_artists'],
      }));
      return;
    }

    if (artists.length > 1 && times.length > 1) {
      const pairCount = Math.min(artists.length, times.length);
      for (let i = 0; i < pairCount; i += 1) {
        events.push(buildEvent({
          venue,
          artistDisplay: artists[i],
          time: times[i],
          date,
          rawBlock: line,
          warnings: ['multiple_artists'],
        }));
      }
      return;
    }

    events.push(buildEvent({
      venue,
      artistDisplay: artists[0],
      time: times[0],
      date,
      rawBlock: line,
      warnings: [],
    }));
  });

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
