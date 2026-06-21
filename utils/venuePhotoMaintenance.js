const path = require('path');
const fs = require('fs');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { inferRegionFromText } = require('./regions');
const slugify = require('./slugify');
const { DEFAULT_EVENT_IMAGE_URL, cleanImageUrl } = require('./eventImages');

const DEFAULT_EVENT_IMAGE_VALUES = new Set([
  '',
  'tbd',
  'tba',
  'n/a',
  'na',
  'none',
  'null',
  'undefined',
]);

const DEFAULT_IMAGE_MARKERS = [
  '/images/event-placeholder.png',
  'event-placeholder.png',
  'alpine-groove-social-cover.png',
  'alpine_groove_guide_icon.png',
  'alpine_groove_guide_favicon.png',
];

const KNOWN_VENUE_NAME_OVERRIDES = new Map([
  ['pikespeakcenterlogo', 'pikes peak center'],
  ['phil long music hall', 'phil long music hall'],
  ['boulder theater', 'boulder theater'],
  ['mission ballroom schedule', 'mission ballroom'],
  ['redrocks', 'red rocks'],
  ['red rocks', 'red rocks'],
  ['ford amphitheater hero', 'ford amphitheater'],
  ['dazzle', 'dazzle'],
  ['nocturne', 'nocturne'],
  ['mining exchange', 'the mining exchange'],
  ['black sheep', 'the black sheep'],
  ['tokki', 'tokki'],
  ['lulu s', "lulu's"],
  ['lulus', "lulu's"],
]);

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'logo',
  'logos',
  'schedule',
  'hero',
  'image',
  'photo',
  'venue',
  'music',
  'hall',
  'ballroom',
  'amphitheater',
  'amphitheatre',
  'center',
  'centre',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'avif',
  'svg',
]);

const normalizeComparableText = (value) => (
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/\bcolorado\b/g, ' ')
    .replace(/\bco\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

const normalizeVenueCandidateName = (value) => {
  const comparable = normalizeComparableText(value);
  if (KNOWN_VENUE_NAME_OVERRIDES.has(comparable)) {
    return normalizeComparableText(KNOWN_VENUE_NAME_OVERRIDES.get(comparable));
  }

  for (const [marker, replacement] of KNOWN_VENUE_NAME_OVERRIDES.entries()) {
    if (comparable.includes(marker)) {
      return normalizeComparableText(replacement);
    }
  }

  return comparable;
};

const tokensFor = (value, { removeStopWords = false } = {}) => {
  const tokens = normalizeComparableText(value).split(' ').filter(Boolean);
  if (!removeStopWords) return tokens;
  return tokens.filter((token) => !STOP_WORDS.has(token));
};

const jaccard = (left, right) => {
  const a = new Set(tokensFor(left, { removeStopWords: true }));
  const b = new Set(tokensFor(right, { removeStopWords: true }));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  a.forEach((token) => {
    if (b.has(token)) intersection += 1;
  });
  return intersection / (a.size + b.size - intersection);
};

const filenameToVenueHint = (filePath) => {
  const parsed = path.parse(String(filePath || ''));
  return normalizeVenueCandidateName(parsed.name);
};

const classifyImageValue = (value) => {
  const raw = String(value || '').trim();
  const normalized = raw.toLowerCase();

  if (DEFAULT_EVENT_IMAGE_VALUES.has(normalized)) {
    return { status: 'missing', repairable: true, reason: 'empty_or_placeholder_text' };
  }

  if (DEFAULT_IMAGE_MARKERS.some((marker) => normalized.includes(marker))) {
    return { status: 'default', repairable: true, reason: 'default_alpine_image' };
  }

  if (!/^https?:\/\//i.test(raw) && !raw.startsWith('/')) {
    return { status: 'possibly_broken', repairable: true, reason: 'not_url_or_public_path' };
  }

  return { status: 'set', repairable: false, reason: 'image_value_present' };
};

const scoreVenuePhotoMatch = (filePath, venue) => {
  const hint = filenameToVenueHint(filePath);
  const venueName = normalizeVenueCandidateName(venue?.display_name || venue?.venue_name || '');
  if (!hint || !venueName) {
    return null;
  }

  const exact = hint === venueName;
  const contains = hint.includes(venueName) || venueName.includes(hint);
  const score = exact ? 1 : contains ? 0.92 : jaccard(hint, venueName);

  if (score < 0.45) return null;

  return {
    profile_id: venue.id || null,
    display_name: venue.display_name || venue.venue_name,
    confidence: score >= 0.9 ? 'high' : score >= 0.65 ? 'medium' : 'low',
    score: Number(score.toFixed(3)),
    reason: exact
      ? 'filename_exact_normalized_match'
      : contains
        ? 'filename_contains_normalized_venue_name'
        : 'filename_token_similarity',
  };
};

const rankPhotoMatches = (filePath, venues) => (
  venues
    .map((venue) => {
      const match = scoreVenuePhotoMatch(filePath, venue);
      return match ? { ...match, venue } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
);

const buildVenueNameFrequency = (events) => {
  const map = new Map();
  events.forEach((event) => {
    const rawName = event.venue_name || event.location;
    const normalized = normalizeVenueCandidateName(rawName);
    if (!normalized) return;
    const current = map.get(normalized) || {
      normalized_name: normalized,
      display_name: rawName,
      count: 0,
      sample_event_ids: [],
      city: event.city || null,
      region: event.region || null,
    };
    current.count += 1;
    if (current.sample_event_ids.length < 5 && event.id) current.sample_event_ids.push(event.id);
    map.set(normalized, current);
  });
  return [...map.values()].sort((a, b) => b.count - a.count);
};

const eventLinkedToVenue = (event, venue) => {
  if (event.venue_profile_id && venue.id && Number(event.venue_profile_id) === Number(venue.id)) {
    return true;
  }
  return normalizeVenueCandidateName(event.venue_name || event.location) === normalizeVenueCandidateName(venue.display_name);
};

const existingColumns = async (db, tableName, columns) => {
  const entries = await Promise.all(
    columns.map(async (column) => [column, await db.schema.hasColumn(tableName, column)])
  );
  return new Set(entries.filter(([, exists]) => exists).map(([column]) => column));
};

const selectExistingColumns = (availableColumns, columns) => (
  columns.filter((column) => availableColumns.has(column))
);

const buildVenuePhotoDryRunReport = async (db, { filePaths = [], eventLimit = 250 } = {}) => {
  const artistColumns = await existingColumns(db, 'artists', [
    'id',
    'display_name',
    'slug',
    'profile_type',
    'is_shell',
    'profile_image',
    'venue_address',
    'venue_city',
    'venue_state',
    'home_region',
    'website',
    'deleted_at',
    'updated_at',
  ]);
  const eventColumns = await existingColumns(db, 'events', [
    'id',
    'title',
    'date',
    'venue_name',
    'venue_profile_id',
    'location',
    'address',
    'region',
    'poster',
    'source',
    'source_label',
    'created_at',
  ]);

  const venueSelect = selectExistingColumns(artistColumns, [
    'id',
    'display_name',
    'slug',
    'profile_type',
    'is_shell',
    'profile_image',
    'venue_address',
    'venue_city',
    'venue_state',
    'home_region',
    'website',
  ]);
  const eventSelect = selectExistingColumns(eventColumns, [
    'id',
    'title',
    'date',
    'venue_name',
    'venue_profile_id',
    'location',
    'address',
    'region',
    'poster',
    'source',
    'source_label',
  ]);

  const venueQuery = db('artists').select(venueSelect);
  if (artistColumns.has('profile_type')) {
    venueQuery.where({ profile_type: 'venue' });
  }
  if (artistColumns.has('deleted_at')) {
    venueQuery.whereNull('deleted_at');
  }
  if (artistColumns.has('display_name')) {
    venueQuery.orderBy('display_name');
  }
  const venues = await venueQuery;

  const eventQuery = db('events').select(eventSelect);
  if (eventColumns.has('created_at')) {
    eventQuery.orderBy('created_at', 'desc');
  } else if (eventColumns.has('date')) {
    eventQuery.orderBy('date', 'desc');
  }
  const events = await eventQuery.limit(eventLimit);

  const photoMatches = filePaths.map((filePath) => {
    const matches = rankPhotoMatches(filePath, venues);
    const best = matches[0] || null;
    const currentImage = best?.venue?.profile_image || null;
    const currentImageStatus = classifyImageValue(currentImage);
    return {
      file_path: filePath,
      filename_hint: filenameToVenueHint(filePath),
      suggested_venue: best?.display_name || null,
      existing_profile_id: best?.profile_id || null,
      confidence: best?.confidence || 'none',
      score: best?.score || 0,
      reason: best?.reason || 'no_candidate_match',
      current_profile_image: currentImage,
      current_profile_image_status: currentImageStatus.status,
      proposed_action: best && currentImageStatus.repairable
        ? 'set_profile_image_after_admin_approval'
        : best
          ? 'review_existing_profile_image_before_overwrite'
          : 'needs_manual_match',
      alternatives: matches.slice(1, 4).map((match) => ({
        profile_id: match.profile_id,
        display_name: match.display_name,
        confidence: match.confidence,
        score: match.score,
        reason: match.reason,
      })),
    };
  });

  const matchedVenueIds = new Set(
    photoMatches
      .filter((match) => match.existing_profile_id && ['high', 'medium'].includes(match.confidence))
      .map((match) => Number(match.existing_profile_id))
  );

  const matchedVenues = venues.filter((venue) => matchedVenueIds.has(Number(venue.id)));
  const eventImageBackfillPreview = [];
  matchedVenues.forEach((venue) => {
    events
      .filter((event) => eventLinkedToVenue(event, venue))
      .forEach((event) => {
        const imageStatus = classifyImageValue(event.poster);
        eventImageBackfillPreview.push({
          event_id: event.id,
          title: event.title,
          date: event.date,
          venue_name: event.venue_name || event.location,
          venue_profile_id: event.venue_profile_id || venue.id,
          current_poster: event.poster,
          image_status: imageStatus.status,
          proposed_display_fallback: venue.profile_image || null,
          proposed_action: imageStatus.repairable
            ? 'display_venue_image_or_backfill_after_approval'
            : 'no_change_valid_event_poster',
        });
      });
  });

  const existingVenueNames = new Set(venues.map((venue) => normalizeVenueCandidateName(venue.display_name)));
  const missingVenues = buildVenueNameFrequency(events)
    .filter((venueName) => venueName.count >= 2 && !existingVenueNames.has(venueName.normalized_name))
    .slice(0, 25)
    .map((venueName) => ({
      name: venueName.display_name,
      normalized_name: venueName.normalized_name,
      region: venueName.region || inferRegionFromText(venueName.display_name, venueName.city),
      event_count: venueName.count,
      sample_event_ids: venueName.sample_event_ids,
      confidence: venueName.count >= 4 ? 'medium' : 'low',
      reason: 'appears_in_recent_events_without_matching_venue_profile',
      recommended_action: venueName.count >= 4 ? 'admin_review_create_shell' : 'admin_review_only',
    }));

  const brokenEventImages = events
    .map((event) => ({ event, imageStatus: classifyImageValue(event.poster) }))
    .filter(({ imageStatus }) => imageStatus.repairable)
    .map(({ event, imageStatus }) => ({
      event_id: event.id,
      title: event.title,
      date: event.date,
      venue_name: event.venue_name || event.location,
      venue_profile_id: event.venue_profile_id || null,
      current_poster: event.poster,
      image_status: imageStatus.status,
      reason: imageStatus.reason,
      recommended_action: event.venue_profile_id
        ? 'use_linked_venue_image_or_default'
        : 'match_or_create_venue_then_use_fallback',
    }));

  return {
    generated_at: new Date().toISOString(),
    dry_run: true,
    summary: {
      photo_count: filePaths.length,
      venue_profile_count: venues.length,
      scanned_event_count: events.length,
      high_confidence_matches: photoMatches.filter((match) => match.confidence === 'high').length,
      medium_confidence_matches: photoMatches.filter((match) => match.confidence === 'medium').length,
      needs_review: photoMatches.filter((match) => !['high', 'medium'].includes(match.confidence)).length,
      missing_venue_candidates: missingVenues.length,
      broken_or_default_event_images: brokenEventImages.length,
    },
    photo_matches: photoMatches,
    event_image_backfill_preview: eventImageBackfillPreview,
    missing_venues: missingVenues,
    broken_event_images: brokenEventImages,
  };
};

const contentTypeForFile = (filePath) => {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.avif') return 'image/avif';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
};

const uploadVenueImage = async (s3, { filePath, bucket, region }) => {
  if (!s3) throw new Error('S3 client is required to upload venue images.');
  if (!bucket) throw new Error('AWS_S3_BUCKET_NAME is required to upload venue images.');
  if (!region) throw new Error('AWS_REGION is required to upload venue images.');
  if (!fs.existsSync(filePath)) throw new Error(`Image file not found: ${filePath}`);

  const key = `venue-profiles/${Date.now()}-${path.basename(filePath).replace(/\s+/g, '-')}`;
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fs.createReadStream(filePath),
    ContentType: contentTypeForFile(filePath),
  }));

  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
};

const buildUniqueSlug = async (trx, displayName) => {
  const base = slugify(displayName) || 'venue';
  let candidate = base;
  let suffix = 1;
  while (await trx('artists').where({ slug: candidate }).whereNull('deleted_at').first('id')) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
};

const maybeUploadImage = async ({ s3, filePath, imageUrl, bucket, region, execute }) => {
  if (imageUrl) return imageUrl;
  if (!filePath) return null;
  if (!execute) return `DRY_RUN_UPLOAD:${filePath}`;
  return uploadVenueImage(s3, { filePath, bucket, region });
};

const applyVenuePhotoMaintenancePlan = async (
  db,
  {
    approvals = {},
    execute = false,
    s3 = null,
    bucket = process.env.AWS_S3_BUCKET_NAME,
    region = process.env.AWS_REGION,
    actorUserId = null,
  } = {}
) => {
  const result = {
    execute,
    venues_updated: [],
    shell_venues_created: [],
    events_updated: [],
    skipped: [],
  };

  const venuePhotoUpdates = Array.isArray(approvals.venue_photo_updates)
    ? approvals.venue_photo_updates
    : [];
  const shellVenues = Array.isArray(approvals.shell_venues)
    ? approvals.shell_venues
    : [];
  const eventImageRepairs = Array.isArray(approvals.event_image_repairs)
    ? approvals.event_image_repairs
    : [];

  await db.transaction(async (trx) => {
    for (const update of venuePhotoUpdates) {
      const profileId = Number(update.profile_id);
      if (!Number.isInteger(profileId) || profileId <= 0) {
        result.skipped.push({ type: 'venue_photo_update', reason: 'invalid_profile_id', input: update });
        continue;
      }

      const venue = await trx('artists')
        .where({ id: profileId, profile_type: 'venue' })
        .whereNull('deleted_at')
        .first();

      if (!venue) {
        result.skipped.push({ type: 'venue_photo_update', reason: 'venue_not_found', input: update });
        continue;
      }

      const currentImageStatus = classifyImageValue(venue.profile_image);
      if (!currentImageStatus.repairable && update.force !== true) {
        result.skipped.push({
          type: 'venue_photo_update',
          profile_id: profileId,
          reason: 'existing_profile_image_preserved',
        });
        continue;
      }

      const nextImage = await maybeUploadImage({
        s3,
        filePath: update.file_path,
        imageUrl: update.image_url,
        bucket,
        region,
        execute,
      });

      if (!nextImage) {
        result.skipped.push({ type: 'venue_photo_update', profile_id: profileId, reason: 'missing_image_input' });
        continue;
      }

      result.venues_updated.push({
        profile_id: profileId,
        display_name: venue.display_name,
        previous_profile_image: venue.profile_image || null,
        next_profile_image: nextImage,
        action: execute ? 'updated_profile_image' : 'would_update_profile_image',
      });

      if (execute) {
        await trx('artists')
          .where({ id: profileId })
          .update({
            profile_image: nextImage,
            updated_at: trx.fn.now(),
          });
      }
    }

    for (const shell of shellVenues) {
      const displayName = String(shell.display_name || shell.name || '').trim();
      if (!displayName) {
        result.skipped.push({ type: 'shell_venue', reason: 'missing_display_name', input: shell });
        continue;
      }

      const normalized = normalizeVenueCandidateName(displayName);
      const existing = await trx('artists')
        .where({ profile_type: 'venue' })
        .whereNull('deleted_at')
        .whereRaw('LOWER(TRIM(display_name)) = LOWER(TRIM(?))', [displayName])
        .first();

      if (existing) {
        result.skipped.push({
          type: 'shell_venue',
          reason: 'existing_venue_profile_found',
          existing_profile_id: existing.id,
          display_name: existing.display_name,
        });
        continue;
      }

      const fuzzyExisting = await trx('artists')
        .where({ profile_type: 'venue' })
        .whereNull('deleted_at')
        .select('id', 'display_name');
      const duplicateCandidate = fuzzyExisting.find((venue) =>
        normalizeVenueCandidateName(venue.display_name) === normalized
      );

      if (duplicateCandidate) {
        result.skipped.push({
          type: 'shell_venue',
          reason: 'normalized_duplicate_venue_profile_found',
          existing_profile_id: duplicateCandidate.id,
          display_name: duplicateCandidate.display_name,
        });
        continue;
      }

      const profileImage = await maybeUploadImage({
        s3,
        filePath: shell.profile_image_file_path || shell.file_path,
        imageUrl: shell.profile_image || shell.image_url,
        bucket,
        region,
        execute,
      });
      const slug = await buildUniqueSlug(trx, displayName);
      const payload = {
        user_id: null,
        display_name: displayName,
        slug,
        profile_type: 'venue',
        bio: shell.bio || `${displayName} is an unclaimed venue profile on Alpine Groove Guide.`,
        contact_email: null,
        profile_image: profileImage && !profileImage.startsWith('DRY_RUN_UPLOAD:') ? profileImage : null,
        website: shell.website || null,
        home_region: shell.home_region || shell.region || inferRegionFromText(displayName, shell.venue_city, shell.city),
        venue_address: shell.venue_address || shell.address || null,
        venue_city: shell.venue_city || shell.city || null,
        venue_state: shell.venue_state || shell.state || 'CO',
        venue_postal_code: shell.venue_postal_code || shell.postal_code || null,
        venue_phone: shell.venue_phone || shell.phone || null,
        age_policy: shell.age_policy || null,
        is_shell: true,
        shell_created_by_user_id: actorUserId,
        is_approved: true,
        is_listed: true,
        is_pro: false,
        trial_active: false,
      };

      result.shell_venues_created.push({
        display_name: displayName,
        slug,
        profile_image: profileImage,
        action: execute ? 'created_shell_venue' : 'would_create_shell_venue',
      });

      if (execute) {
        const [created] = await trx('artists').insert(payload).returning('id');
        result.shell_venues_created[result.shell_venues_created.length - 1].profile_id =
          typeof created === 'object' ? created.id : created;
      }
    }

    for (const repair of eventImageRepairs) {
      const eventId = Number(repair.event_id);
      if (!Number.isInteger(eventId) || eventId <= 0) {
        result.skipped.push({ type: 'event_image_repair', reason: 'invalid_event_id', input: repair });
        continue;
      }

      const event = await trx('events')
        .leftJoin('artists as venue_profile', 'events.venue_profile_id', 'venue_profile.id')
        .select('events.*', 'venue_profile.profile_image as venue_profile_image')
        .where('events.id', eventId)
        .first();

      if (!event) {
        result.skipped.push({ type: 'event_image_repair', event_id: eventId, reason: 'event_not_found' });
        continue;
      }

      const currentImageStatus = classifyImageValue(event.poster);
      if (!currentImageStatus.repairable && repair.force !== true) {
        result.skipped.push({ type: 'event_image_repair', event_id: eventId, reason: 'valid_event_poster_preserved' });
        continue;
      }

      const venueImage = cleanImageUrl(event.venue_profile_image);
      const nextPoster = repair.image_url ||
        (repair.use_venue_image !== false && venueImage ? venueImage : null) ||
        (repair.use_default ? DEFAULT_EVENT_IMAGE_URL : null);

      if (!nextPoster) {
        result.skipped.push({ type: 'event_image_repair', event_id: eventId, reason: 'no_repair_image_available' });
        continue;
      }

      result.events_updated.push({
        event_id: eventId,
        title: event.title,
        previous_poster: event.poster || null,
        next_poster: nextPoster,
        action: execute ? 'updated_event_poster' : 'would_update_event_poster',
      });

      if (execute) {
        await trx('events')
          .where({ id: eventId })
          .update({
            poster: nextPoster,
            updated_at: trx.fn.now(),
          });
      }
    }

  });

  return result;
};

module.exports = {
  applyVenuePhotoMaintenancePlan,
  buildVenuePhotoDryRunReport,
  classifyImageValue,
  filenameToVenueHint,
  jaccard,
  normalizeComparableText,
  normalizeVenueCandidateName,
  scoreVenuePhotoMatch,
};
