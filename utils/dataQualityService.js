const dayjs = require('dayjs');
const { resolveEventImage, isUsableImageValue, isDefaultImage } = require('./eventImages');
const { findDuplicateCandidates } = require('./eventDuplicateDetection');
const {
  confidenceFromScore,
  normalizeEntityName,
  sameCityOrUnknown,
  sameRegionOrUnknown,
  tokenSimilarity,
} = require('./entityMatching');
const { canonicalVenueLookupName } = require('./venueProfiles');

const ISSUE_SEVERITY_WEIGHT = {
  critical: 0,
  warning: 1,
  suggestion: 2,
};

const IMAGE_FIXABLE_STATUSES = new Set(['missing', 'default_or_invalid']);

const parseWarningsField = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return value.split('\n').map((item) => item.trim()).filter(Boolean);
  }
};

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const weakTitle = (event) => {
  const title = cleanText(event.title);
  if (!title) return true;
  if (title.length < 4) return true;
  const venue = cleanText(event.venue_profile_display_name || event.venue_name);
  if (venue && normalizeEntityName(title) === normalizeEntityName(venue)) return true;
  return /^(live music|show|concert|event|music)$/i.test(title);
};

const weakDescription = (event) => {
  const description = cleanText(event.description);
  return !description || description.length < 20 || /^(tbd|tba|none)$/i.test(description);
};

const issueId = (entityType, entityId, issueType) => `${entityType}:${entityId}:${issueType}`;

const buildIssue = ({
  entityType,
  entityId,
  entityName,
  issueType,
  severity,
  title,
  description,
  region = null,
  source = null,
  importBatchId = null,
  currentValue,
  suggestedFixes = [],
  metadata = {},
  lastUpdated = null,
}) => ({
  id: issueId(entityType, entityId, issueType),
  entityType,
  entityId: String(entityId),
  entityName: entityName || `${entityType} #${entityId}`,
  issueType,
  severity,
  title,
  description,
  region,
  source,
  importBatchId,
  currentValue,
  suggestedFixes,
  metadata,
  lastUpdated,
});

const selectEventRows = (db) => db('events as e')
  .leftJoin('artists as venue_profile', 'e.venue_profile_id', 'venue_profile.id')
  .leftJoin('artists as artist_profile', 'e.artist_profile_id', 'artist_profile.id')
  .select(
    'e.*',
    'venue_profile.display_name as venue_profile_display_name',
    'venue_profile.slug as venue_profile_slug',
    'venue_profile.profile_image as venue_profile_image',
    'venue_profile.home_region as venue_profile_region',
    'venue_profile.venue_city as venue_profile_city',
    'venue_profile.venue_state as venue_profile_state',
    'venue_profile.venue_address as venue_profile_address',
    'artist_profile.display_name as artist_profile_display_name',
    'artist_profile.slug as artist_profile_slug'
  );

const selectVenueRows = (db) => db('artists as a')
  .select(
    'a.*',
    db.raw('COUNT(e.id) as upcoming_event_count')
  )
  .leftJoin('events as e', function joinEvents() {
    this.on('e.venue_profile_id', 'a.id')
      .andOn('e.is_approved', db.raw('?', [true]))
      .andOn('e.date', '>=', db.raw('CURRENT_DATE'));
  })
  .where({ 'a.profile_type': 'venue' })
  .whereNull('a.deleted_at')
  .groupBy('a.id');

const loadVenueCandidates = async (db) => {
  const venues = await db('artists')
    .select(
      'id',
      'display_name',
      'slug',
      'profile_image',
      'website',
      'home_region',
      'venue_address',
      'venue_city',
      'venue_state',
      'is_shell',
      'is_approved'
    )
    .where({ profile_type: 'venue' })
    .whereNull('deleted_at');

  let aliases = [];
  try {
    aliases = await db('venue_aliases')
      .select('venue_profile_id', 'alias', 'normalized_alias', 'confidence', 'is_verified')
      .where({ is_verified: true });
  } catch (error) {
    if (error?.code !== '42P01' && error?.code !== 'SQLITE_ERROR') throw error;
  }

  const aliasesByVenueId = new Map();
  aliases.forEach((alias) => {
    const list = aliasesByVenueId.get(alias.venue_profile_id) || [];
    list.push(alias);
    aliasesByVenueId.set(alias.venue_profile_id, list);
  });

  return venues.map((venue) => ({
    ...venue,
    aliases: aliasesByVenueId.get(venue.id) || [],
  }));
};

const suggestVenueMatches = (event, venues) => {
  const rawName = cleanText(event.venue_name || event.location);
  if (!rawName) return [];
  const normalizedRaw = canonicalVenueLookupName(rawName);
  const region = event.region || null;
  const city = event.city || event.venue_profile_city || null;

  return venues
    .map((venue) => {
      const canonical = canonicalVenueLookupName(venue.display_name);
      const alias = venue.aliases.find((candidate) => candidate.normalized_alias === normalizedRaw);
      let score = 0;
      let reason = 'name_similarity';

      if (canonical && canonical === normalizedRaw) {
        score = 1;
        reason = 'exact_canonical_name';
      } else if (alias) {
        score = Number(alias.confidence || 1);
        reason = 'verified_alias';
      } else {
        score = tokenSimilarity(rawName, venue.display_name, { removeVenueSuffixes: true });
      }

      if (!sameRegionOrUnknown(region, venue.home_region)) score -= 0.18;
      if (!sameCityOrUnknown(city, venue.venue_city)) score -= 0.1;
      score = Math.max(0, Math.min(1, score));

      if (score < 0.58) return null;
      return {
        action: 'attach_venue_profile',
        label: `Attach ${venue.display_name}`,
        confidence: confidenceFromScore(score),
        score: Number(score.toFixed(3)),
        reason,
        payload: {
          venue_profile_id: venue.id,
          venue_name: venue.display_name,
          slug: venue.slug,
        },
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
};

const suggestArtistMatches = (event, artists) => {
  const searchText = cleanText(event.artist_display || event.title);
  if (!searchText || event.artist_profile_id) return [];
  return artists
    .map((artist) => {
      const score = tokenSimilarity(searchText, artist.display_name);
      if (score < 0.58) return null;
      return {
        action: 'attach_artist_profile',
        label: `Attach ${artist.display_name}`,
        confidence: confidenceFromScore(score),
        score: Number(score.toFixed(3)),
        payload: {
          artist_profile_id: artist.id,
          artist_name: artist.display_name,
          slug: artist.slug,
        },
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
};

const calculateEventHealthScore = (event) => {
  const image = resolveEventImage(event);
  const weights = [
    { key: 'title', weight: 12, ok: !weakTitle(event) },
    { key: 'date', weight: 14, ok: Boolean(event.date && dayjs(event.date).isValid()) },
    { key: 'time', weight: 10, ok: Boolean(event.start_time) },
    { key: 'venue', weight: 16, ok: Boolean(event.venue_profile_id) },
    { key: 'region', weight: 10, ok: Boolean(event.region) },
    { key: 'image', weight: 10, ok: image.display_image_source !== 'default' },
    { key: 'artist', weight: 10, ok: Boolean(event.artist_profile_id || event.artist_profile_display_name) },
    { key: 'description', weight: 8, ok: !weakDescription(event) },
    { key: 'link', weight: 5, ok: Boolean(event.website_link || event.website) },
    { key: 'source', weight: 5, ok: Boolean(event.source || event.source_label || event.user_id) },
  ];
  const total = weights.reduce((sum, item) => sum + item.weight, 0);
  const earned = weights.reduce((sum, item) => sum + (item.ok ? item.weight : 0), 0);
  return {
    score: Math.round((earned / total) * 100),
    checks: weights.map((item) => ({ key: item.key, ok: item.ok, weight: item.weight })),
  };
};

const buildEventIssues = async (db, { limitEvents = 400 } = {}) => {
  const [events, venues, artists] = await Promise.all([
    selectEventRows(db).orderBy('e.date', 'desc').limit(limitEvents),
    loadVenueCandidates(db),
    db('artists').select('id', 'display_name', 'slug', 'home_region').where({ profile_type: 'artist' }).whereNull('deleted_at').limit(750),
  ]);
  const duplicateCandidates = await findDuplicateCandidates(db, events, { daysBack: 7, daysForward: 120 });
  const duplicateDecisionKeys = new Set();
  try {
    const rows = await db('duplicate_event_decisions')
      .select('left_event_id', 'right_event_id', 'decision')
      .whereIn('decision', ['merge', 'reject_duplicate', 'approve_separate']);
    rows.forEach((row) => {
      const left = Number(row.left_event_id);
      const right = Number(row.right_event_id);
      if (Number.isFinite(left) && Number.isFinite(right)) {
        duplicateDecisionKeys.add(`${Math.min(left, right)}:${Math.max(left, right)}`);
      }
    });
  } catch (error) {
    if (error?.code !== '42P01' && error?.code !== 'SQLITE_ERROR') throw error;
  }
  const eventArtistsByEvent = new Map();
  try {
    const rows = await db('event_artists').select('event_id').count('* as count').groupBy('event_id');
    rows.forEach((row) => eventArtistsByEvent.set(Number(row.event_id), Number(row.count || 0)));
  } catch (error) {
    if (error?.code !== '42P01' && error?.code !== 'SQLITE_ERROR') throw error;
  }

  const issues = [];
  events.forEach((event, index) => {
    const image = resolveEventImage(event);
    const eventName = event.title || `Event #${event.id}`;
    const metadata = {
      slug: event.slug,
      date: event.date,
      start_time: event.start_time,
      venue_name: event.venue_name,
      health: calculateEventHealthScore(event),
    };

    if (!event.venue_profile_id && cleanText(event.venue_name || event.location)) {
      issues.push(buildIssue({
        entityType: 'event',
        entityId: event.id,
        entityName: eventName,
        issueType: 'missing_venue_link',
        severity: 'warning',
        title: 'Event is not linked to a canonical venue',
        description: 'This event has venue text but no venue profile relationship, which weakens venue calendars, images, SEO, and duplicate detection.',
        region: event.region,
        source: event.source_label || event.source,
        currentValue: event.venue_name || event.location,
        suggestedFixes: suggestVenueMatches(event, venues),
        metadata,
        lastUpdated: event.updated_at,
      }));
    }

    if (!event.artist_profile_id && !eventArtistsByEvent.get(Number(event.id))) {
      issues.push(buildIssue({
        entityType: 'event',
        entityId: event.id,
        entityName: eventName,
        issueType: 'missing_artist_link',
        severity: 'suggestion',
        title: 'Event has no linked artist profile',
        description: 'Linking performers makes artist schedules, claims, embeds, and search more accurate.',
        region: event.region,
        source: event.source_label || event.source,
        currentValue: event.title,
        suggestedFixes: suggestArtistMatches(event, artists),
        metadata,
        lastUpdated: event.updated_at,
      }));
    }

    if (image.display_image_source === 'default' || IMAGE_FIXABLE_STATUSES.has(image.event_poster_status)) {
      issues.push(buildIssue({
        entityType: 'event',
        entityId: event.id,
        entityName: eventName,
        issueType: image.event_poster_status === 'default_or_invalid' ? 'broken_image' : 'fallback_image',
        severity: image.event_poster_status === 'default_or_invalid' ? 'warning' : 'suggestion',
        title: image.event_poster_status === 'default_or_invalid' ? 'Event poster appears broken' : 'Event is using a fallback image',
        description: 'A stronger poster or venue image will improve the public card, shares, and weekly poster output.',
        region: event.region,
        source: event.source_label || event.source,
        currentValue: event.poster,
        suggestedFixes: event.venue_profile_image
          ? [{ action: 'apply_venue_image', label: 'Use linked venue image', confidence: 'high', payload: { poster: event.venue_profile_image } }]
          : [],
        metadata: { ...metadata, display_image_source: image.display_image_source, event_poster_status: image.event_poster_status },
        lastUpdated: event.updated_at,
      }));
    }

    if (weakTitle(event)) {
      issues.push(buildIssue({
        entityType: 'event',
        entityId: event.id,
        entityName: eventName,
        issueType: 'weak_title',
        severity: 'warning',
        title: 'Event title needs cleanup',
        description: 'The title is missing, generic, or too close to only the venue name.',
        region: event.region,
        source: event.source_label || event.source,
        currentValue: event.title,
        metadata,
        lastUpdated: event.updated_at,
      }));
    }

    if (weakDescription(event)) {
      issues.push(buildIssue({
        entityType: 'event',
        entityId: event.id,
        entityName: eventName,
        issueType: 'weak_description',
        severity: 'suggestion',
        title: 'Event description is thin',
        description: 'A short useful description improves search, sharing, and fan confidence.',
        region: event.region,
        source: event.source_label || event.source,
        currentValue: event.description,
        metadata,
        lastUpdated: event.updated_at,
      }));
    }

    if (!event.region) {
      issues.push(buildIssue({
        entityType: 'event',
        entityId: event.id,
        entityName: eventName,
        issueType: 'missing_region',
        severity: 'critical',
        title: 'Event is missing a region',
        description: 'Regional pages and filters require one primary region.',
        source: event.source_label || event.source,
        metadata,
        lastUpdated: event.updated_at,
      }));
    }

    const eventDate = event.date ? dayjs(event.date) : null;
    if (!event.date || !eventDate?.isValid() || !event.start_time) {
      issues.push(buildIssue({
        entityType: 'event',
        entityId: event.id,
        entityName: eventName,
        issueType: 'invalid_or_missing_datetime',
        severity: 'critical',
        title: 'Event date or start time needs review',
        description: 'A valid date and start time are required before the event should be trusted publicly.',
        region: event.region,
        source: event.source_label || event.source,
        currentValue: { date: event.date, start_time: event.start_time },
        metadata,
        lastUpdated: event.updated_at,
      }));
    }

    const duplicates = (duplicateCandidates.get(index) || [])
      .filter((candidate) => {
        const candidateId = Number(candidate?.event?.id);
        const eventId = Number(event.id);
        if (!Number.isFinite(candidateId) || candidateId === eventId) return false;
        return !duplicateDecisionKeys.has(`${Math.min(candidateId, eventId)}:${Math.max(candidateId, eventId)}`);
      });
    if (duplicates.length) {
      const best = duplicates[0];
      issues.push(buildIssue({
        entityType: 'event',
        entityId: event.id,
        entityName: eventName,
        issueType: 'possible_duplicate',
        severity: best.level === 'exact' || best.level === 'likely' ? 'warning' : 'suggestion',
        title: 'Possible duplicate event',
        description: 'This event resembles an existing event. Compare before approving or editing.',
        region: event.region,
        source: event.source_label || event.source,
        suggestedFixes: [{
          action: 'compare_duplicate',
          label: `Compare with ${best.event?.title || `event #${best.event?.id}`}`,
          confidence: best.level,
          score: Number(best.score || 0),
          payload: {
            existing_event_id: best.event?.id,
            reason: best.reason,
            candidate: best.event,
          },
        }],
        metadata: { ...metadata, duplicate_candidates: duplicates.slice(0, 3) },
        lastUpdated: event.updated_at,
      }));
    }
  });

  return issues;
};

const buildVenueIssues = async (db) => {
  const venues = await selectVenueRows(db).orderBy('a.updated_at', 'desc').limit(300);
  const issues = [];

  venues.forEach((venue) => {
    const missing = [];
    if (!cleanText(venue.venue_address)) missing.push('address');
    if (!cleanText(venue.venue_city)) missing.push('city');
    if (!cleanText(venue.home_region)) missing.push('region');
    if (!cleanText(venue.website)) missing.push('website');
    if (!isUsableImageValue(venue.profile_image)) missing.push('image');

    if (missing.length) {
      issues.push(buildIssue({
        entityType: 'venue',
        entityId: venue.id,
        entityName: venue.display_name,
        issueType: venue.is_shell ? 'incomplete_shell_venue' : 'incomplete_venue_profile',
        severity: venue.is_shell && Number(venue.upcoming_event_count || 0) > 0 ? 'warning' : 'suggestion',
        title: venue.is_shell ? 'Shell venue needs profile details' : 'Venue profile is incomplete',
        description: `Missing: ${missing.join(', ')}.`,
        region: venue.home_region,
        currentValue: missing,
        metadata: {
          slug: venue.slug,
          is_shell: Boolean(venue.is_shell),
          upcoming_event_count: Number(venue.upcoming_event_count || 0),
        },
        lastUpdated: venue.updated_at,
      }));
    }
  });

  return issues;
};

const buildClaimIssues = async (db) => {
  let claims = [];
  try {
    claims = await db('event_claim_requests as ecr')
      .leftJoin('events as e', 'ecr.event_id', 'e.id')
      .leftJoin('artists as a', 'ecr.artist_profile_id', 'a.id')
      .select(
        'ecr.*',
        'e.title as event_title',
        'e.slug as event_slug',
        'e.region',
        'a.display_name as profile_name',
        'a.slug as profile_slug',
        'a.profile_type'
      )
      .where({ 'ecr.status': 'pending' })
      .orderBy('ecr.created_at', 'asc')
      .limit(100);
  } catch (error) {
    if (error?.code !== '42P01' && error?.code !== 'SQLITE_ERROR') throw error;
  }

  return claims.map((claim) => buildIssue({
    entityType: 'claim',
    entityId: claim.id,
    entityName: `${claim.profile_name || 'Profile'} → ${claim.event_title || 'Event'}`,
    issueType: 'pending_claim',
    severity: 'warning',
    title: 'Claim request awaiting review',
    description: 'Review this claim before attaching edit access to the listing.',
    region: claim.region,
    suggestedFixes: [
      { action: 'approve_claim', label: 'Approve claim', confidence: 'manual', payload: { claim_id: claim.id } },
      { action: 'reject_claim', label: 'Reject claim', confidence: 'manual', payload: { claim_id: claim.id } },
    ],
    metadata: claim,
    lastUpdated: claim.updated_at || claim.created_at,
  }));
};

const buildImportIssues = async (db) => {
  let rows = [];
  try {
    rows = await db('import_events as ie')
      .leftJoin('import_batches as ib', 'ie.batch_id', 'ib.id')
      .select('ie.*', 'ib.source_name', 'ib.status as batch_status')
      .whereNull('ie.promoted_event_id')
      .whereIn('ie.status', ['pending', 'accepted'])
      .orderBy('ie.created_at', 'desc')
      .limit(250);
  } catch (error) {
    if (error?.code !== '42P01' && error?.code !== 'SQLITE_ERROR') throw error;
  }

  const issues = [];
  rows.forEach((row) => {
    const warnings = parseWarningsField(row.parse_warnings);
    const needsAttention = (
      !row.venue_profile_id ||
      !row.region ||
      !row.poster ||
      warnings.some((warning) => String(warning).startsWith('duplicate_'))
    );
    if (!needsAttention) return;

    issues.push(buildIssue({
      entityType: 'import_event',
      entityId: row.id,
      entityName: row.title || row.artist_display || `Import row #${row.id}`,
      issueType: 'import_needs_attention',
      severity: warnings.some((warning) => String(warning).includes('duplicate')) ? 'warning' : 'suggestion',
      title: 'Import row needs review',
      description: 'This staged import row has missing links, missing image data, missing region, or duplicate warnings.',
      region: row.region,
      source: row.source_name || row.source,
      importBatchId: row.batch_id,
      currentValue: {
        status: row.status,
        venue_name: row.venue_name,
        artist_display: row.artist_display,
        warnings,
      },
      metadata: {
        batch_id: row.batch_id,
        source: row.source,
        warnings,
      },
      lastUpdated: row.updated_at || row.created_at,
    }));
  });

  return issues;
};

const applyIssueFilters = (issues, filters = {}) => {
  let next = issues;
  if (filters.entityType) next = next.filter((issue) => issue.entityType === filters.entityType);
  if (filters.issueType) next = next.filter((issue) => issue.issueType === filters.issueType);
  if (filters.severity) next = next.filter((issue) => issue.severity === filters.severity);
  if (filters.region) next = next.filter((issue) => issue.region === filters.region);
  if (filters.source) next = next.filter((issue) => String(issue.source || '').toLowerCase().includes(String(filters.source).toLowerCase()));
  if (filters.importBatchId) next = next.filter((issue) => String(issue.importBatchId || '') === String(filters.importBatchId));
  if (filters.readyToFix === 'true') next = next.filter((issue) => issue.suggestedFixes?.length);
  if (filters.q) {
    const query = String(filters.q).toLowerCase();
    next = next.filter((issue) => (
      String(issue.entityName || '').toLowerCase().includes(query) ||
      String(issue.title || '').toLowerCase().includes(query) ||
      String(issue.description || '').toLowerCase().includes(query)
    ));
  }
  return next;
};

const sortIssues = (issues, sort = 'severity') => {
  const next = [...issues];
  if (sort === 'newest') {
    return next.sort((a, b) => new Date(b.lastUpdated || 0) - new Date(a.lastUpdated || 0));
  }
  if (sort === 'oldest') {
    return next.sort((a, b) => new Date(a.lastUpdated || 0) - new Date(b.lastUpdated || 0));
  }
  if (sort === 'confidence') {
    return next.sort((a, b) => Number(b.suggestedFixes?.[0]?.score || 0) - Number(a.suggestedFixes?.[0]?.score || 0));
  }
  return next.sort((a, b) => {
    const severityDiff = ISSUE_SEVERITY_WEIGHT[a.severity] - ISSUE_SEVERITY_WEIGHT[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return Number(b.suggestedFixes?.[0]?.score || 0) - Number(a.suggestedFixes?.[0]?.score || 0);
  });
};

const summarizeIssues = (issues) => {
  const byIssueType = {};
  const bySeverity = {};
  issues.forEach((issue) => {
    byIssueType[issue.issueType] = (byIssueType[issue.issueType] || 0) + 1;
    bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
  });
  return {
    total: issues.length,
    critical: bySeverity.critical || 0,
    warnings: bySeverity.warning || 0,
    suggestions: bySeverity.suggestion || 0,
    events_missing_venue_links: byIssueType.missing_venue_link || 0,
    events_missing_artist_links: byIssueType.missing_artist_link || 0,
    broken_or_fallback_images: (byIssueType.broken_image || 0) + (byIssueType.fallback_image || 0),
    possible_duplicates: byIssueType.possible_duplicate || 0,
    incomplete_shell_venues: byIssueType.incomplete_shell_venue || 0,
    pending_claims: byIssueType.pending_claim || 0,
    imports_needing_attention: byIssueType.import_needs_attention || 0,
    byIssueType,
    bySeverity,
  };
};

const getDataQualityIssues = async (db, query = {}) => {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(Number.parseInt(query.pageSize, 10) || 50, 10), 100);
  const [eventIssues, venueIssues, claimIssues, importIssues] = await Promise.all([
    buildEventIssues(db),
    buildVenueIssues(db),
    buildClaimIssues(db),
    buildImportIssues(db),
  ]);
  const allIssues = [...eventIssues, ...venueIssues, ...claimIssues, ...importIssues];
  const filtered = sortIssues(applyIssueFilters(allIssues, query), query.sort);
  const offset = (page - 1) * pageSize;
  return {
    issues: filtered.slice(offset, offset + pageSize),
    page,
    pageSize,
    total: filtered.length,
    summary: summarizeIssues(allIssues),
    filters: query,
  };
};

const getDataQualitySummary = async (db) => {
  const result = await getDataQualityIssues(db, { pageSize: 10 });
  return result.summary;
};

module.exports = {
  calculateEventHealthScore,
  getDataQualityIssues,
  getDataQualitySummary,
  parseWarningsField,
  suggestVenueMatches,
};
