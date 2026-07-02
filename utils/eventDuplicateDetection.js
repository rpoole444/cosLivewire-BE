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

const venueSimilarity = (left, right) => {
  const normalizedLeft = normalizeComparableText(left);
  const normalizedRight = normalizeComparableText(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;

  const a = tokenSet(normalizedLeft);
  const b = tokenSet(normalizedRight);
  if (!a.size || !b.size) return 0;

  let intersection = 0;
  a.forEach((token) => {
    if (b.has(token)) intersection += 1;
  });

  const coverage = intersection / Math.min(a.size, b.size);
  const jaccard = intersection / (a.size + b.size - intersection);
  return Math.max(jaccard, coverage >= 1 ? 0.95 : coverage >= 0.75 ? 0.86 : coverage);
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
  if (value instanceof Date) return null;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};

const timeDistanceMinutes = (left, right) => {
  const a = normalizeTime(left);
  const b = normalizeTime(right);
  if (a === null || b === null) return null;
  return Math.abs(a - b);
};

const eventDisplayTitle = (event) => event.title || event.artist_display || event.artist || '';
const eventVenueName = (event) => (
  event.venue_profile_display_name ||
  event.venue_name ||
  event.venue ||
  event.location ||
  ''
);
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

  const venueScore = venueSimilarity(eventVenueName(incoming), existing.venue_name || existing.location || '');
  const venueProfileScore = venueSimilarity(eventVenueName(incoming), existing.venue_profile_display_name || '');
  const bestVenueScore = Math.max(venueScore, venueProfileScore);
  const titleScore = jaccardSimilarity(eventDisplayTitle(incoming), existing.title || '');
  const artistScore = jaccardSimilarity(eventArtistName(incoming), existing.title || existing.genre || '');
  const titleArtistScore = Math.max(titleScore, artistScore);
  const timeDistance = timeDistanceMinutes(incoming.start_time, existing.start_time);
  const closeTime = timeDistance === null ? false : timeDistance <= 45;
  const exactTime = timeDistance === 0;

  if (bestVenueScore >= 0.9 && exactTime && titleArtistScore >= 0.72) {
    return {
      level: 'likely',
      score: Math.max(titleArtistScore, bestVenueScore),
      reason: 'same_venue_date_time_similar_title',
    };
  }

  if (bestVenueScore >= 0.9 && exactTime && titleArtistScore >= 0.3) {
    return {
      level: 'likely',
      score: Math.max(0.86, titleArtistScore, bestVenueScore),
      reason: 'same_venue_date_time_related_title',
    };
  }

  if (bestVenueScore >= 0.9 && exactTime) {
    return {
      level: 'possible',
      score: Math.max(0.72, bestVenueScore),
      reason: 'same_venue_date_time',
    };
  }

  if (bestVenueScore >= 0.72 && closeTime && titleArtistScore >= 0.55) {
    return {
      level: 'possible',
      score: Math.max(titleArtistScore, bestVenueScore),
      reason: 'similar_venue_date_close_time',
    };
  }

  if (exactTime && titleArtistScore >= 0.82) {
    return {
      level: 'possible',
      score: titleArtistScore,
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
  const dates = events.map((event) => normalizeDate(event.date)).filter(Boolean);
  if (!dates.length) return new Map();

  const minDate = dates.reduce((min, date) => (date < min ? date : min), dates[0]);
  const maxDate = dates.reduce((max, date) => (date > max ? date : max), dates[0]);
  const startDate = new Date(`${minDate}T00:00:00Z`);
  const endDate = new Date(`${maxDate}T00:00:00Z`);
  startDate.setUTCSeconds(startDate.getUTCSeconds() - (daysBack * DAY_SECONDS));
  endDate.setUTCSeconds(endDate.getUTCSeconds() + (daysForward * DAY_SECONDS));

  const existingEvents = await db('events')
    .leftJoin('artists as venue_profile', 'events.venue_profile_id', 'venue_profile.id')
    .select(
      'events.id',
      'events.title',
      'events.slug',
      'events.date',
      'events.start_time',
      'events.venue_name',
      'events.location',
      'events.region',
      'events.source',
      'events.source_label',
      'events.source_fingerprint',
      'events.venue_profile_id',
      'venue_profile.display_name as venue_profile_display_name'
    )
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
  normalizeDate,
  scorePotentialDuplicate,
  venueSimilarity,
};
