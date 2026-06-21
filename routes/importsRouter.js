const express = require('express');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const { parseMoondogCalendar } = require('../utils/parseMoondogCalendar');
const { ensureAuth, requireAdmin } = require('../middleware/auth');
const { DEFAULT_REGION, normalizeRegion, inferRegionFromText } = require('../utils/regions');
const { findVenueProfileByInput, normalizeVenueName } = require('../utils/venueProfiles');
const {
  duplicateWarningForLevel,
  findDuplicateCandidates,
} = require('../utils/eventDuplicateDetection');
const slugify = require('../utils/slugify');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config);

const importsRouter = express.Router();

const SOURCE_CONFIG = {
  moondog: {
    label: 'Provided by Moondog',
    ownerEmail: 'mike@moondogmusicshop.com',
    defaultRegion: DEFAULT_REGION,
    defaultPoster: 'https://alpinegg-posters.s3.us-east-2.amazonaws.com/promoters/moondog-music-shop.png',
  },
  profile: {
    label: 'Provided by Alpine Groove Guide',
    ownerEmail: null,
    defaultRegion: DEFAULT_REGION,
    defaultPoster: 'https://app.alpinegrooveguide.com/alpine-groove-social-cover.png',
  },
};

const normalizeInsertedId = (insertResult) => {
  if (!Array.isArray(insertResult)) return insertResult;
  const first = insertResult[0];
  if (first && typeof first === 'object' && 'id' in first) {
    return first.id;
  }
  return first;
};

const countWarnings = (events) => {
  return events.reduce((total, event) => {
    if (!Array.isArray(event.parse_warnings)) return total;
    return total + event.parse_warnings.length;
  }, 0);
};

const appendWarning = (event, warning) => {
  const warnings = Array.isArray(event.parse_warnings) ? [...event.parse_warnings] : [];
  if (!warnings.includes(warning)) warnings.push(warning);
  return {
    ...event,
    parse_warnings: warnings,
  };
};

const appendWarnings = (event, warningsToAdd = []) => {
  return warningsToAdd.reduce((nextEvent, warning) => appendWarning(nextEvent, warning), event);
};

const cleanPosterInput = (value) => {
  const cleaned = cleanOptionalImportText(value, 255);
  if (!cleaned) return null;
  if (['tbd', 'tba', 'n/a', 'na', 'none', 'null'].includes(cleaned.toLowerCase())) {
    return null;
  }
  return cleaned;
};

const getVenueProfileCacheKey = ({ venueProfileId, venueName } = {}) => {
  const parsedId = parseOptionalProfileId(venueProfileId);
  if (parsedId) return `id:${parsedId}`;
  return `name:${normalizeVenueName(venueName)}`;
};

const resolveVenueProfileForImport = async (db, cache, { venueProfileId, venueName } = {}) => {
  const key = getVenueProfileCacheKey({ venueProfileId, venueName });
  if (!key || key === 'name:') return null;
  if (!cache.has(key)) {
    const venue = await findVenueProfileByInput(db, { venueProfileId, venueName });
    cache.set(key, venue || null);
  }
  return cache.get(key);
};

const resolveImportPoster = ({ explicitPoster, venueProfile, profileDefaultPoster, sourceDefaultPoster }) => (
  cleanPosterInput(explicitPoster) ||
  cleanPosterInput(venueProfile?.profile_image) ||
  cleanPosterInput(profileDefaultPoster) ||
  cleanPosterInput(sourceDefaultPoster)
);

const getDuplicateRejectedRows = async (source, parsedEvents) => {
  const fingerprints = parsedEvents
    .map((event) => event.fingerprint)
    .filter(Boolean);

  if (!fingerprints.length) return new Map();

  const existingEvents = await knex('events')
    .select('id', 'source_fingerprint')
    .where({ source })
    .whereIn('source_fingerprint', fingerprints)
    .catch((error) => {
      if (error?.code === '42703') {
        return [];
      }
      throw error;
    });

  const existingImportEvents = await knex('import_events')
    .select('id', 'fingerprint', 'promoted_event_id')
    .where({ source })
    .whereIn('fingerprint', fingerprints)
    .andWhere(function() {
      this.whereIn('status', ['pending', 'accepted'])
        .orWhereNotNull('promoted_event_id');
    });

  const rejected = new Map();
  const eventFingerprints = new Set(existingEvents.map((event) => event.source_fingerprint));
  const importFingerprints = new Set(existingImportEvents.map((event) => event.fingerprint));
  const seenInThisBatch = new Set();

  parsedEvents.forEach((event, index) => {
    if (!event.fingerprint) return;

    if (eventFingerprints.has(event.fingerprint)) {
      rejected.set(index, 'duplicate_existing_event');
      return;
    }

    if (importFingerprints.has(event.fingerprint)) {
      rejected.set(index, 'duplicate_existing_import');
      return;
    }

    if (seenInThisBatch.has(event.fingerprint)) {
      rejected.set(index, 'duplicate_in_batch');
      return;
    }

    seenInThisBatch.add(event.fingerprint);
  });

  return rejected;
};

const resolveSourceOwnerUserId = async (db, source, batch) => {
  const sourceConfig = SOURCE_CONFIG[source] || {};
  const ownerEmail = String(sourceConfig.ownerEmail || '').trim().toLowerCase();

  if (ownerEmail) {
    const owner = await db('users')
      .select('id')
      .whereRaw('LOWER(TRIM(email)) = ?', [ownerEmail])
      .first();

    if (!owner) {
      console.warn(`[IMPORT PROMOTE] source owner not found for ${source}: ${ownerEmail}`);
      return null;
    }

    return owner.id;
  }

  return batch?.created_by_user_id || null;
};

const canManageBatch = (req, batch) => (
  Boolean(req.user?.is_admin) || (
    batch?.created_by_user_id &&
    req.user?.id &&
    Number(batch.created_by_user_id) === Number(req.user.id)
  )
);

const createImportBatch = async (req, res, source) => {
  try {
    const { raw_text, defaults = {}, source_name, source_url } = req.body;
    if (!raw_text || typeof raw_text !== 'string') {
      return res.status(400).json({ message: 'raw_text is required' });
    }

    const sourceConfig = SOURCE_CONFIG[source];
    if (!sourceConfig) {
      return res.status(400).json({ message: 'Unsupported import source.' });
    }

    const promoterEnv = source === 'moondog' ? process.env.MOONDOG_PROMOTER_ID : null;
    const promoterId = promoterEnv && Number.isInteger(Number(promoterEnv))
      ? Number(promoterEnv)
      : null;
    if (source === 'moondog' && !promoterId) {
      console.warn('promoter_unassigned');
    }

    const parsedEvents = parseMoondogCalendar(raw_text);
    const duplicateRejectedRows = await getDuplicateRejectedRows(source, parsedEvents);
    const defaultArtistProfileId = parseOptionalProfileId(defaults.artist_profile_id);
    const defaultVenueProfileId = parseOptionalProfileId(defaults.venue_profile_id);
    let profileDefaults = {
      artist_profile_id: defaultArtistProfileId,
      venue_profile_id: defaultVenueProfileId,
      artist_display: cleanOptionalImportText(defaults.artist_display, 255),
      venue_name: cleanOptionalImportText(defaults.venue_name, 255),
      location: cleanOptionalImportText(defaults.location || defaults.venue_name, 255),
      address: cleanOptionalImportText(defaults.address, 255),
      city: cleanOptionalImportText(defaults.city, 255),
      website: cleanOptionalImportText(defaults.website, 255),
      website_link: cleanOptionalImportText(defaults.website_link, 255),
      age_policy: cleanOptionalImportText(defaults.age_policy, 120),
      poster: cleanPosterInput(defaults.poster),
      region: normalizeRegion(defaults.region, sourceConfig.defaultRegion || DEFAULT_REGION),
    };

    if (defaultArtistProfileId) {
      const artist = await knex('artists')
        .select('id', 'display_name', 'website', 'profile_image', 'home_region', 'user_id')
        .where({ id: defaultArtistProfileId, profile_type: 'artist' })
        .whereNull('deleted_at')
        .first();

      if (!artist) {
        return res.status(400).json({ message: 'Selected artist profile was not found.' });
      }
      if (!req.user?.is_admin && artist.user_id !== req.user?.id) {
        return res.status(403).json({ message: 'You can only import with profiles you manage.' });
      }

      profileDefaults = {
        ...profileDefaults,
        artist_profile_id: artist.id,
        artist_display: profileDefaults.artist_display || artist.display_name || null,
        website: profileDefaults.website || artist.website || null,
        website_link: profileDefaults.website_link || profileDefaults.website || artist.website || null,
        poster: profileDefaults.poster || artist.profile_image || null,
        region: normalizeRegion(profileDefaults.region, artist.home_region || sourceConfig.defaultRegion || DEFAULT_REGION),
      };
    }

    if (defaultVenueProfileId) {
      const venue = await knex('artists')
        .select('id', 'display_name', 'venue_address', 'venue_city', 'website', 'age_policy', 'profile_image', 'home_region', 'user_id')
        .where({ id: defaultVenueProfileId, profile_type: 'venue' })
        .whereNull('deleted_at')
        .first();

      if (!venue) {
        return res.status(400).json({ message: 'Selected venue profile was not found.' });
      }
      if (!req.user?.is_admin && venue.user_id !== req.user?.id) {
        return res.status(403).json({ message: 'You can only import with profiles you manage.' });
      }

      profileDefaults = {
        ...profileDefaults,
        venue_profile_id: venue.id,
        venue_name: profileDefaults.venue_name || venue.display_name || null,
        location: profileDefaults.location || venue.display_name || null,
        address: profileDefaults.address || venue.venue_address || null,
        city: profileDefaults.city || venue.venue_city || null,
        website: profileDefaults.website || venue.website || null,
        website_link: profileDefaults.website_link || profileDefaults.website || venue.website || null,
        age_policy: profileDefaults.age_policy || venue.age_policy || null,
        poster: profileDefaults.poster || venue.profile_image || null,
        region: normalizeRegion(profileDefaults.region, venue.home_region || sourceConfig.defaultRegion || DEFAULT_REGION),
      };
    }

    const venueProfileCache = new Map();
    let stagedEvents = [];
    for (let index = 0; index < parsedEvents.length; index += 1) {
      const event = parsedEvents[index];
      const duplicateWarning = duplicateRejectedRows.get(index);
      const venueProfile = await resolveVenueProfileForImport(knex, venueProfileCache, {
        venueProfileId: event.venue_profile_id || profileDefaults.venue_profile_id,
        venueName: event.venue_name || profileDefaults.venue_name,
      });
      const eventWithDefaults = {
        ...event,
        artist_display: event.artist_display || profileDefaults.artist_display,
        artist_profile_id: event.artist_profile_id || profileDefaults.artist_profile_id,
        venue_name: event.venue_name || profileDefaults.venue_name || venueProfile?.display_name || null,
        location: event.location || profileDefaults.location || event.venue_name || profileDefaults.venue_name || venueProfile?.display_name || null,
        address: event.address || profileDefaults.address || venueProfile?.venue_address || null,
        city: event.city || profileDefaults.city || venueProfile?.venue_city || null,
        website: event.website || profileDefaults.website || venueProfile?.website || null,
        website_link: event.website_link || profileDefaults.website_link || event.website || profileDefaults.website || venueProfile?.website || null,
        age_policy: event.age_policy || profileDefaults.age_policy,
        poster: resolveImportPoster({
          explicitPoster: event.poster,
          venueProfile,
          profileDefaultPoster: profileDefaults.poster,
          sourceDefaultPoster: sourceConfig.defaultPoster,
        }),
        venue_profile_id: event.venue_profile_id || profileDefaults.venue_profile_id || venueProfile?.id || null,
        region: event.region || profileDefaults.region || venueProfile?.home_region || sourceConfig.defaultRegion || DEFAULT_REGION,
      };

      stagedEvents.push(duplicateWarning ? appendWarning(eventWithDefaults, duplicateWarning) : eventWithDefaults);
    }

    const duplicateCandidates = await findDuplicateCandidates(knex, stagedEvents);
    stagedEvents = stagedEvents.map((event, index) => {
      const matches = duplicateCandidates.get(index) || [];
      if (!matches.length) return event;

      const warnings = matches.map((match) => duplicateWarningForLevel(match.level));
      return appendWarnings(event, warnings);
    });
    const warningCount = countWarnings(stagedEvents);

    const batchId = await knex.transaction(async (trx) => {
      const insertedBatch = await trx('import_batches')
        .insert({
          source,
          source_name: cleanOptionalImportText(source_name || defaults.source_name, 160),
          source_url: cleanOptionalImportText(source_url || defaults.source_url, 500),
          raw_text,
          created_by_user_id: req.user?.id || null,
        })
        .returning('id');

      const resolvedBatchId = normalizeInsertedId(insertedBatch);

      const rows = stagedEvents.map((event, index) => ({
        batch_id: resolvedBatchId,
        status: duplicateRejectedRows.has(index) ? 'rejected' : 'pending',
        promoter_id: promoterId,
        source,
        venue_name: event.venue_name,
        title: event.title || null,
        artist_display: event.artist_display,
        artist_profile_id: event.artist_profile_id || null,
        start_at: event.start_at,
        date: event.date,
        start_time: event.start_time,
        region: event.region,
        venue_profile_id: event.venue_profile_id || null,
        location: event.location || null,
        address: event.address || null,
        city: event.city || null,
        website: event.website || null,
        website_link: event.website_link || null,
        description: event.description || null,
        genre: event.genre || null,
        age_policy: event.age_policy || null,
        poster: event.poster || null,
        raw_block: event.raw_block,
        parse_warnings: JSON.stringify(event.parse_warnings || []),
        fingerprint: event.fingerprint,
      }));

      if (rows.length) {
        await trx('import_events').insert(rows);
      }

      return resolvedBatchId;
    });

    return res.status(201).json({
      batchId,
      parsedCount: parsedEvents.length,
      warningCount,
    });
  } catch (error) {
    console.error('Error creating import batch:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

importsRouter.post('/moondog', requireAdmin, (req, res) => createImportBatch(req, res, 'moondog'));
importsRouter.post('/profile', ensureAuth, (req, res) => createImportBatch(req, res, 'profile'));

importsRouter.post('/shell-profiles', requireAdmin, async (req, res) => {
  try {
    const {
      display_name,
      profile_type,
      slug: requestedSlug,
      home_region,
      profile_image,
      website,
      venue_address,
      venue_city,
      venue_state,
      age_policy,
    } = req.body || {};

    const normalizedType = ['artist', 'venue', 'promoter'].includes(String(profile_type || '').toLowerCase())
      ? String(profile_type).toLowerCase()
      : 'artist';
    const displayName = cleanOptionalImportText(display_name, 255);
    if (!displayName) {
      return res.status(400).json({ message: 'Display name is required.' });
    }

    const baseSlug = slugify(requestedSlug || displayName);
    if (!baseSlug) {
      return res.status(400).json({ message: 'Could not generate a valid slug.' });
    }

    const existing = await knex('artists')
      .where({ slug: baseSlug })
      .whereNull('deleted_at')
      .first();

    if (existing) {
      if (existing.is_shell) {
        return res.json({
          profile: existing,
          message: 'A shell profile with this slug already exists.',
        });
      }
      return res.status(409).json({ message: 'A claimed or active profile with that slug already exists.' });
    }

    const [profile] = await knex('artists')
      .insert({
        user_id: null,
        display_name: displayName,
        slug: baseSlug,
        profile_type: normalizedType,
        bio: normalizedType === 'venue'
          ? `${displayName} is an unclaimed venue profile on Alpine Groove Guide.`
          : `${displayName} is an unclaimed artist profile on Alpine Groove Guide.`,
        contact_email: null,
        profile_image: cleanPosterInput(profile_image),
        website: cleanOptionalImportText(website, 255),
        home_region: normalizeRegion(home_region, DEFAULT_REGION),
        venue_address: normalizedType === 'venue' ? cleanOptionalImportText(venue_address, 255) : null,
        venue_city: normalizedType === 'venue' ? cleanOptionalImportText(venue_city, 255) : null,
        venue_state: normalizedType === 'venue' ? cleanOptionalImportText(venue_state, 64) : null,
        age_policy: normalizedType === 'venue' ? cleanOptionalImportText(age_policy, 80) : null,
        is_shell: true,
        shell_created_by_user_id: req.user?.id || null,
        is_approved: true,
        is_listed: true,
        is_pro: false,
        trial_active: false,
      })
      .returning('*');

    return res.status(201).json({ profile });
  } catch (error) {
    if (error?.code === '42703') {
      return res.status(500).json({ message: 'Shell profile migration has not been run yet.' });
    }
    console.error('Error creating shell profile:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

importsRouter.get('/duplicates/recent', requireAdmin, async (req, res) => {
  try {
    const { scorePotentialDuplicate } = require('../utils/eventDuplicateDetection');
    const limit = Math.min(Math.max(Number(req.query.limit) || 80, 1), 250);
    const events = await knex('events')
      .select('id', 'title', 'date', 'start_time', 'venue_name', 'location', 'region', 'source', 'source_label', 'source_fingerprint')
      .orderBy('created_at', 'desc')
      .limit(limit);

    const pairs = [];
    for (let i = 0; i < events.length; i += 1) {
      for (let j = i + 1; j < events.length; j += 1) {
        const match = scorePotentialDuplicate(events[i], events[j]);
        if (match) {
          pairs.push({
            event_a: events[i],
            event_b: events[j],
            confidence: match.level,
            score: Number(match.score.toFixed(3)),
            reason: match.reason,
            suggested_action: match.level === 'exact' || match.level === 'likely'
              ? 'review_merge_or_delete_duplicate'
              : 'review_manually',
          });
        }
      }
    }

    return res.json({
      scanned_count: events.length,
      duplicate_pairs: pairs.sort((a, b) => b.score - a.score),
    });
  } catch (error) {
    console.error('Error scanning duplicate events:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

const parseWarningsField = (value) => {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }
  return [];
};

const parseOptionalProfileId = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const cleanOptionalImportText = (value, maxLength = 500) => {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
};

const hasDuplicateWarning = (event) => {
  return parseWarningsField(event.parse_warnings).some((warning) =>
    [
      'duplicate_existing_event',
      'duplicate_existing_import',
      'duplicate_in_batch',
      'duplicate_exact',
      'duplicate_likely',
      'duplicate_possible',
    ].includes(warning)
  );
};

const getDenverDateTimeParts = (value) => {
  if (!value) return {};
  const parsed = dayjs(value).tz('America/Denver');
  if (!parsed.isValid()) return {};
  return {
    date: parsed.format('YYYY-MM-DD'),
    start_time: parsed.format('HH:mm:ss'),
  };
};

const normalizeImportTime = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  const parsed = dayjs(trimmed, ['HH:mm:ss', 'HH:mm', 'h:mm A', 'h A'], true);
  if (!parsed.isValid()) return null;
  return parsed.format('HH:mm:ss');
};

const normalizeImportDate = (value) => {
  if (!value) return null;
  const parsed = dayjs(String(value).trim(), ['YYYY-MM-DD', 'M/D/YYYY', 'MM/DD/YYYY'], true);
  if (!parsed.isValid()) return null;
  return parsed.format('YYYY-MM-DD');
};

const generateUniqueEventSlug = async (trx, title, reservedSlugs) => {
  const baseSlug = slugify(title || 'untitled-event') || 'untitled-event';
  let candidate = baseSlug;
  let suffix = 1;

  while (reservedSlugs.has(candidate) || await trx('events').where({ slug: candidate }).first('id')) {
    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  reservedSlugs.add(candidate);
  return candidate;
};

// Promote accepted import events into public events (all-or-nothing).
importsRouter.post('/:source/:batchId/promote', requireAdmin, async (req, res) => {
  try {
    const { source } = req.params;
    const batchId = Number(req.params.batchId);
    if (!source || !Number.isInteger(batchId)) {
      return res.status(400).json({ message: 'Invalid source or batchId' });
    }

    const summary = await knex.transaction(async (trx) => {
      const batch = await trx('import_batches')
        .where({ id: batchId, source })
        .first();
      if (!batch) return { error: 'batch_not_found' };
      if (batch.status === 'completed') return { error: 'batch_already_completed' };

      const acceptedEvents = await trx('import_events')
        .where({
          batch_id: batchId,
          source,
          status: 'accepted',
        })
        .whereNull('promoted_event_id')
        .orderBy('id');

      const totalEvents = await trx('import_events')
        .where({ batch_id: batchId, source })
        .count('* as count')
        .first();
      const totalCount = Number(totalEvents?.count || 0);

      if (!acceptedEvents.length) {
        return { promoted_count: 0, skipped_count: totalCount, batch_id: batchId };
      }

      const sourceConfig = SOURCE_CONFIG[source] || {};
      const sourceOwnerUserId = await resolveSourceOwnerUserId(trx, source, batch);

      const normalizeTimeParts = (value) => {
        const parts = String(value).trim().split(':').map((part) => part.padStart(2, '0'));
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1] || '00', 10);
        const seconds = parseInt(parts[2] || '00', 10);
        return { hours, minutes, seconds };
      };

      const reservedSlugs = new Set();

      const addTwoHours = (timeValue) => {
        const { hours, minutes, seconds } = normalizeTimeParts(timeValue);
        const totalSeconds = (hours * 3600) + (minutes * 60) + seconds + (2 * 3600);
        const wrappedSeconds = totalSeconds % 86400;
        const finalHours = Math.floor(wrappedSeconds / 3600);
        const finalMinutes = Math.floor((wrappedSeconds % 3600) / 60);
        const finalSeconds = wrappedSeconds % 60;
        return [
          String(finalHours).padStart(2, '0'),
          String(finalMinutes).padStart(2, '0'),
          String(finalSeconds).padStart(2, '0'),
        ].join(':');
      };

      let promotedCount = 0;
      let duplicateSkippedCount = 0;

      for (const event of acceptedEvents) {
        // Use literal local date/time from the import record; no timezone conversion here.
        const fallbackTiming = getDenverDateTimeParts(event.start_at);
        const finalDate = event.date || fallbackTiming.date || null;
        if (!finalDate) {
          throw new Error(`Missing date for import_event ${event.id}`);
        }

        const finalStartTime = event.start_time || fallbackTiming.start_time || null;
        if (!finalStartTime) {
          throw new Error(`Missing start_time for import_event ${event.id}`);
        }

        // Default end_time to enforce completeness at promotion time.
        const finalEndTime = event.end_time || addTwoHours(finalStartTime);

        console.log(
          `[IMPORT PROMOTE] "${event.title || event.artist_display || 'Untitled Event'}" date=${finalDate} start_time=${finalStartTime}`
        );

        const venueProfile = await findVenueProfileByInput(trx, {
          venueProfileId: event.venue_profile_id,
          venueName: event.venue_name,
        });
        const venueProfileId = venueProfile?.id || null;
        const poster = resolveImportPoster({
          explicitPoster: event.poster,
          venueProfile,
          profileDefaultPoster: null,
          sourceDefaultPoster: sourceConfig.defaultPoster,
        });
        const artistProfileId = parseOptionalProfileId(event.artist_profile_id);

        const title = event.title || event.artist_display || 'Untitled Event';
        const slug = await generateUniqueEventSlug(trx, title, reservedSlugs);
        const sourceFingerprint = event.fingerprint || null;

        if (sourceFingerprint) {
          const existingEvent = await trx('events')
            .select('id')
            .where({ source, source_fingerprint: sourceFingerprint })
            .first();

          if (existingEvent) {
            duplicateSkippedCount += 1;
            await trx('import_events')
              .where({ id: event.id })
              .update({
                status: 'rejected',
                promoted_event_id: existingEvent.id,
                parse_warnings: JSON.stringify([
                  ...parseWarningsField(event.parse_warnings),
                  'duplicate_existing_event',
                ]),
              });
            continue;
          }
        }

        const rows = await trx('events')
          .insert({
            user_id: event.user_id || sourceOwnerUserId || null,
            title,
            description: event.description || '',
            location: event.location || event.venue_name || '',
            address: event.address || '',
            date: finalDate,
            genre: event.genre || null,
            region: normalizeRegion(
              event.region,
              sourceConfig.defaultRegion || inferRegionFromText(event.city, event.location, event.address, event.venue_name)
            ),
            ticket_price: null,
            age_restriction: event.age_policy || null,
            website_link: event.website_link || null,
            is_approved: false,
            venue_name: event.venue_name || null,
            venue_profile_id: venueProfileId,
            artist_profile_id: artistProfileId,
            website: event.website || null,
            poster,
            start_time: finalStartTime,
            end_time: finalEndTime,
            slug,
            source,
            source_label: sourceConfig.label || null,
            source_fingerprint: sourceFingerprint,
            source_import_event_id: event.id,
          })
          .returning('id');

        const promotedEventId = Array.isArray(rows) ? rows[0]?.id || rows[0] : rows;
        promotedCount += 1;

        await trx('import_events')
          .where({ id: event.id })
          .update({ promoted_event_id: promotedEventId });
      }

      await trx('import_batches')
        .where({ id: batchId })
        .update({
          status: 'completed',
          completed_at: knex.fn.now(),
        });

      return {
        promoted_count: promotedCount,
        skipped_count: totalCount - promotedCount,
        duplicate_skipped_count: duplicateSkippedCount,
        batch_id: batchId,
      };
    });

    if (summary.error === 'batch_not_found') {
      return res.status(404).json({ message: 'Import batch not found' });
    }
    if (summary.error === 'batch_already_completed') {
      return res.status(400).json({ message: 'Import batch already completed' });
    }

    return res.json(summary);
  } catch (error) {
    console.error('Error promoting import batch:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

// Moderation endpoints for staged imports (no promotion to events here).
importsRouter.post('/:source/events/:eventId/accept', ensureAuth, async (req, res) => {
  try {
    const { source } = req.params;
    const eventId = Number(req.params.eventId);
    if (!source || !Number.isInteger(eventId)) {
      return res.status(400).json({ message: 'Invalid source or eventId' });
    }

    const updatedEvent = await knex.transaction(async (trx) => {
      const event = await trx('import_events')
        .where({ id: eventId, source })
        .first();

      if (!event) {
        return null;
      }

      const batch = await trx('import_batches')
        .where({ id: event.batch_id, source })
        .first();
      if (!canManageBatch(req, batch)) return { error: 'Forbidden', status: 403 };

      if (event.promoted_event_id) {
        return { error: 'Event has already been promoted' };
      }

      const rows = await trx('import_events')
        .where({ id: eventId })
        .update({
          status: 'accepted',
          accepted_by: req.user?.id || null,
          accepted_at: knex.fn.now(),
          rejected_by: null,
          rejected_at: null,
        })
        .returning('*');

      return rows[0];
    });

    if (!updatedEvent) {
      return res.status(404).json({ message: 'Import event not found' });
    }
    if (updatedEvent.error) {
      if (updatedEvent.status === 403) {
        return res.status(403).json({ message: updatedEvent.error });
      }
      return res.status(400).json({ message: updatedEvent.error });
    }

  return res.json({
      ...updatedEvent,
      parse_warnings: parseWarningsField(updatedEvent.parse_warnings),
    });
  } catch (error) {
    console.error('Error accepting import event:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

importsRouter.post('/:source/events/:eventId/reject', ensureAuth, async (req, res) => {
  try {
    const { source } = req.params;
    const eventId = Number(req.params.eventId);
    if (!source || !Number.isInteger(eventId)) {
      return res.status(400).json({ message: 'Invalid source or eventId' });
    }

    const updatedEvent = await knex.transaction(async (trx) => {
      const event = await trx('import_events')
        .where({ id: eventId, source })
        .first();

      if (!event) {
        return null;
      }

      const batch = await trx('import_batches')
        .where({ id: event.batch_id, source })
        .first();
      if (!canManageBatch(req, batch)) return { error: 'Forbidden', status: 403 };

      if (event.promoted_event_id) {
        return { error: 'Event has already been promoted' };
      }

      const rows = await trx('import_events')
        .where({ id: eventId })
        .update({
          status: 'rejected',
          accepted_by: null,
          accepted_at: null,
          rejected_by: req.user?.id || null,
          rejected_at: knex.fn.now(),
        })
        .returning('*');

      return rows[0];
    });

    if (!updatedEvent) {
      return res.status(404).json({ message: 'Import event not found' });
    }
    if (updatedEvent.error) {
      if (updatedEvent.status === 403) {
        return res.status(403).json({ message: updatedEvent.error });
      }
      return res.status(400).json({ message: updatedEvent.error });
    }

    return res.json({
      ...updatedEvent,
      parse_warnings: parseWarningsField(updatedEvent.parse_warnings),
    });
  } catch (error) {
    console.error('Error rejecting import event:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

importsRouter.post('/:source/:batchId/events/bulk', ensureAuth, async (req, res) => {
  try {
    const { source } = req.params;
    const batchId = Number(req.params.batchId);
    const { action } = req.body || {};

    if (!source || !Number.isInteger(batchId)) {
      return res.status(400).json({ message: 'Invalid source or batchId' });
    }

    const supportedActions = ['accept_clean_pending', 'reject_duplicate_pending', 'reject_all_pending'];
    if (!supportedActions.includes(action)) {
      return res.status(400).json({ message: 'Unsupported bulk import action.' });
    }

    const result = await knex.transaction(async (trx) => {
      const batch = await trx('import_batches')
        .where({ id: batchId, source })
        .first();

      if (!batch) return { error: 'batch_not_found' };
      if (!canManageBatch(req, batch)) return { error: 'forbidden' };
      if (batch.status === 'completed') return { error: 'batch_already_completed' };

      const pendingEvents = await trx('import_events')
        .where({ batch_id: batchId, source, status: 'pending' })
        .whereNull('promoted_event_id')
        .orderBy('id');

      const selectedEvents = pendingEvents.filter((event) => {
        const isDuplicate = hasDuplicateWarning(event);
        if (action === 'accept_clean_pending') return !isDuplicate;
        if (action === 'reject_duplicate_pending') return isDuplicate;
        return true;
      });

      if (!selectedEvents.length) {
        return { updatedCount: 0, events: [] };
      }

      const ids = selectedEvents.map((event) => event.id);
      const nextStatus = action === 'accept_clean_pending' ? 'accepted' : 'rejected';
      const updatePayload = nextStatus === 'accepted'
        ? {
            status: nextStatus,
            accepted_by: req.user?.id || null,
            accepted_at: trx.fn.now(),
            rejected_by: null,
            rejected_at: null,
          }
        : {
            status: nextStatus,
            accepted_by: null,
            accepted_at: null,
            rejected_by: req.user?.id || null,
            rejected_at: trx.fn.now(),
          };

      const updatedEvents = await trx('import_events')
        .whereIn('id', ids)
        .update(updatePayload)
        .returning('*');

      return {
        updatedCount: updatedEvents.length,
        events: updatedEvents,
      };
    });

    if (result.error === 'batch_not_found') {
      return res.status(404).json({ message: 'Import batch not found' });
    }
    if (result.error === 'forbidden') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (result.error === 'batch_already_completed') {
      return res.status(400).json({ message: 'Import batch already completed' });
    }

    return res.json({
      updatedCount: result.updatedCount,
      events: result.events.map((event) => ({
        ...event,
        parse_warnings: parseWarningsField(event.parse_warnings),
      })),
    });
  } catch (error) {
    console.error('Error bulk updating import events:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

importsRouter.patch('/:source/:batchId/events/:eventId', ensureAuth, async (req, res) => {
  try {
    const { source } = req.params;
    const batchId = Number(req.params.batchId);
    const eventId = Number(req.params.eventId);

    if (!source || !Number.isInteger(batchId) || !Number.isInteger(eventId)) {
      return res.status(400).json({ message: 'Invalid source, batchId, or eventId' });
    }

    const {
      date,
      time,
      start_time,
      venue,
      venue_name,
      artist_display,
      artist_profile_id,
      venue_profile_id,
      age_policy,
      title,
      description,
      website,
      website_link,
      poster,
      genre,
      region,
    } = req.body || {};

    const updatePayload = {};
    const nextDate = normalizeImportDate(date);
    const nextStartTime = normalizeImportTime(time || start_time);
    const nextVenueName = venue_name ?? venue;

    if (date !== undefined) {
      if (!nextDate) return res.status(400).json({ message: 'Use date format YYYY-MM-DD.' });
      updatePayload.date = nextDate;
    }

    if (time !== undefined || start_time !== undefined) {
      if (!nextStartTime) return res.status(400).json({ message: 'Use time format HH:MM or h:mm AM.' });
      updatePayload.start_time = nextStartTime;
    }

    if (nextVenueName !== undefined) updatePayload.venue_name = String(nextVenueName).trim();
    if (artist_display !== undefined) updatePayload.artist_display = String(artist_display).trim();
    if (title !== undefined) updatePayload.title = String(title).trim();
    if (description !== undefined) updatePayload.description = cleanOptionalImportText(description, 3000);
    if (website !== undefined) updatePayload.website = cleanOptionalImportText(website, 255);
    if (website_link !== undefined) updatePayload.website_link = cleanOptionalImportText(website_link, 255);
    if (poster !== undefined) updatePayload.poster = cleanPosterInput(poster);
    if (genre !== undefined) updatePayload.genre = cleanOptionalImportText(genre, 255);
    if (age_policy !== undefined) updatePayload.age_policy = cleanOptionalImportText(age_policy, 120);
    if (region !== undefined) updatePayload.region = normalizeRegion(region, DEFAULT_REGION);

    const nextArtistProfileId = parseOptionalProfileId(artist_profile_id);
    const nextVenueProfileId = parseOptionalProfileId(venue_profile_id);

    if (artist_profile_id !== undefined) updatePayload.artist_profile_id = nextArtistProfileId;
    if (venue_profile_id !== undefined) updatePayload.venue_profile_id = nextVenueProfileId;

    const updatedEvent = await knex.transaction(async (trx) => {
      const event = await trx('import_events')
        .where({ id: eventId, batch_id: batchId, source })
        .first();

      if (!event) return null;
      const batch = await trx('import_batches')
        .where({ id: batchId, source })
        .first();
      if (!canManageBatch(req, batch)) return { error: 'Forbidden', status: 403 };
      if (event.promoted_event_id) return { error: 'Event has already been promoted' };
      if (!Object.keys(updatePayload).length) return event;

      if (nextArtistProfileId) {
        const artistProfile = await trx('artists')
          .select('id', 'user_id')
          .where({ id: nextArtistProfileId, profile_type: 'artist' })
          .whereNull('deleted_at')
          .first();
        if (!artistProfile) return { error: 'Invalid artist profile' };
        if (!req.user?.is_admin && artistProfile.user_id !== req.user?.id) {
          return { error: 'Forbidden', status: 403 };
        }
      }

      if (nextVenueProfileId) {
        const venueProfile = await trx('artists')
          .select('id', 'user_id')
          .where({ id: nextVenueProfileId, profile_type: 'venue' })
          .whereNull('deleted_at')
          .first();
        if (!venueProfile) return { error: 'Invalid venue profile' };
        if (!req.user?.is_admin && venueProfile.user_id !== req.user?.id) {
          return { error: 'Forbidden', status: 403 };
        }
      }

      const rows = await trx('import_events')
        .where({ id: eventId })
        .update(updatePayload)
        .returning('*');

      return rows[0];
    });

    if (!updatedEvent) {
      return res.status(404).json({ message: 'Import event not found' });
    }
    if (updatedEvent.error) {
      if (updatedEvent.status === 403) {
        return res.status(403).json({ message: updatedEvent.error });
      }
      return res.status(400).json({ message: updatedEvent.error });
    }

    return res.json({
      ...updatedEvent,
      parse_warnings: parseWarningsField(updatedEvent.parse_warnings),
    });
  } catch (error) {
    console.error('Error updating import event:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

importsRouter.get('/:source/:batchId', ensureAuth, async (req, res) => {
  try {
    const { source } = req.params;
    const batchId = Number(req.params.batchId);
    if (!SOURCE_CONFIG[source] || !Number.isInteger(batchId)) {
      return res.status(400).json({ message: 'Invalid source or batchId' });
    }

    const batch = await knex('import_batches')
      .where({ id: batchId, source })
      .first();
    if (!batch) {
      return res.status(404).json({ message: 'Import batch not found' });
    }
    if (!canManageBatch(req, batch)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const events = await knex('import_events')
      .where({ batch_id: batchId, source })
      .orderBy('id');

    return res.json({
      batch,
      canPromote: Boolean(req.user?.is_admin),
      events: events.map((event) => ({
        ...event,
        parse_warnings: parseWarningsField(event.parse_warnings),
      })),
    });
  } catch (error) {
    console.error('Error loading import batch:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

module.exports = importsRouter;
