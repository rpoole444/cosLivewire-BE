const DAY_SECONDS = 24 * 60 * 60;

const normalizeComparableText = (value) => (
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/\bthe\b/g, ' ')
    .replace(/\bfeat(?:uring)?\b/g, ' ')
    .replace(/\bw\/\b/g, ' with ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

const tokenSet = (value) => new Set(normalizeComparableText(value).split(' ').filter((token) => token.length > 1));

const jaccardSimilarity = (left, right) => {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  a.forEach((token) => {
    if (b.has(token)) intersection += 1;
  });
  return intersection / (a.size + b.size - intersection);
};

const normalizeTime = (value) => {
  if (!value) return null;
  const [hours, minutes = '0'] = String(value).split(':');
  const parsedHours = Number.parseInt(hours, 10);
  const parsedMinutes = Number.parseInt(minutes, 10);
  if (!Number.isFinite(parsedHours) || !Number.isFinite(parsedMinutes)) return null;
  return parsedHours * 60 + parsedMinutes;
};

const normalizeDate = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text.slice(0, 10) : parsed.toISOString().slice(0, 10);
};

const timeDistanceMinutes = (left, right) => {
  const a = normalizeTime(left);
  const b = normalizeTime(right);
  if (a === null || b === null) return null;
  return Math.abs(a - b);
};

const eventDisplayTitle = (event) => event.title || event.artist_display || event.artist || '';
const eventVenueName = (event) => event.venue_name || event.venue || event.location || '';
const eventArtistName = (event) => event.artist_display || event.artist || event.title || '';

const scorePotentialDuplicate = (incoming, existing) => {
  if (!incoming || !existing) return null;
  if (incoming.source_url && existing.source_url && incoming.source_url === existing.source_url) {
    return { level: 'exact', score: 1, reason: 'same_source_url' };
  }
  if (
    incoming.fingerprint &&
    existing.source_fingerprint &&
    incoming.fingerprint === existing.source_fingerprint
  ) {
    return { level: 'exact', score: 1, reason: 'same_source_fingerprint' };
  }
  const incomingDate = normalizeDate(incoming.date);
  const existingDate = normalizeDate(existing.date);
  if (incomingDate && existingDate && incomingDate !== existingDate) {
    return null;
  }

  const venueScore = jaccardSimilarity(eventVenueName(incoming), existing.venue_name || existing.location || '');
  const titleScore = jaccardSimilarity(eventDisplayTitle(incoming), existing.title || '');
  const artistScore = jaccardSimilarity(eventArtistName(incoming), existing.title || existing.genre || '');
  const timeDistance = timeDistanceMinutes(incoming.start_time, existing.start_time);
  const closeTime = timeDistance === null ? false : timeDistance <= 45;
  const exactTime = timeDistance === 0;

  if (venueScore >= 0.9 && exactTime && (titleScore >= 0.72 || artistScore >= 0.72)) {
    return {
      level: 'likely',
      score: Math.max(titleScore, artistScore, venueScore),
      reason: 'same_venue_date_time_similar_title',
    };
  }

  if (venueScore >= 0.72 && closeTime && (titleScore >= 0.55 || artistScore >= 0.55)) {
    return {
      level: 'possible',
      score: Math.max(titleScore, artistScore, venueScore),
      reason: 'similar_venue_date_close_time',
    };
  }

  if (exactTime && (titleScore >= 0.82 || artistScore >= 0.82)) {
    return {
      level: 'possible',
      score: Math.max(titleScore, artistScore),
      reason: 'same_date_time_similar_title',
    };
  }

  return null;
};

const duplicateWarningForLevel = (level) => {
  if (level === 'exact') return 'duplicate_exact';
  if (level === 'likely') return 'duplicate_likely';
  return 'duplicate_possible';
};

const findDuplicateCandidates = async (db, incomingEvents, { daysBack = 60, daysForward = 370 } = {}) => {
  const events = Array.isArray(incomingEvents) ? incomingEvents : [incomingEvents].filter(Boolean);
  const dates = events.map((event) => event.date).filter(Boolean).map((date) => String(date).slice(0, 10));
  if (!dates.length) return new Map();

  const minDate = dates.reduce((min, date) => (date < min ? date : min), dates[0]);
  const maxDate = dates.reduce((max, date) => (date > max ? date : max), dates[0]);
  const startDate = new Date(`${minDate}T00:00:00Z`);
  const endDate = new Date(`${maxDate}T00:00:00Z`);
  startDate.setUTCSeconds(startDate.getUTCSeconds() - (daysBack * DAY_SECONDS));
  endDate.setUTCSeconds(endDate.getUTCSeconds() + (daysForward * DAY_SECONDS));

  const existingEvents = await db('events')
    .select('id', 'title', 'slug', 'date', 'start_time', 'venue_name', 'location', 'region', 'source', 'source_label', 'source_fingerprint')
    .whereBetween('date', [
      startDate.toISOString().slice(0, 10),
      endDate.toISOString().slice(0, 10),
    ]);

  const results = new Map();
  events.forEach((incoming, index) => {
    const matches = existingEvents
      .map((existing) => {
        const match = scorePotentialDuplicate(incoming, existing);
        return match ? { ...match, event: existing } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (matches.length) {
      results.set(index, matches);
    }
  });

  return results;
};

module.exports = {
  duplicateWarningForLevel,
  findDuplicateCandidates,
  jaccardSimilarity,
  normalizeComparableText,
  scorePotentialDuplicate,
};
