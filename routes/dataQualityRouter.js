const express = require('express');
const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config);
const {
  getDataQualityIssues,
  getDataQualitySummary,
} = require('../utils/dataQualityService');
const {
  normalizeEntityName,
  tokenSimilarity,
  confidenceFromScore,
} = require('../utils/entityMatching');
const { canonicalVenueLookupName } = require('../utils/venueProfiles');
const { normalizeRegion } = require('../utils/regions');
const { isUsableImageValue } = require('../utils/eventImages');
const { writeAuditLog } = require('../utils/auditLog');

const dataQualityRouter = express.Router();

const parsePositiveInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const cleanText = (value, maxLength = 500) => {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
};

const loadEvent = (db, eventId) => db('events').where({ id: eventId }).first();

const loadVenue = (db, venueId) => db('artists')
  .where({ id: venueId, profile_type: 'venue' })
  .whereNull('deleted_at')
  .first();

dataQualityRouter.get('/summary', async (req, res) => {
  try {
    return res.json(await getDataQualitySummary(knex));
  } catch (error) {
    console.error('Data quality summary error:', error);
    return res.status(500).json({ message: 'Unable to load data-quality summary.' });
  }
});

dataQualityRouter.get('/issues', async (req, res) => {
  try {
    return res.json(await getDataQualityIssues(knex, req.query));
  } catch (error) {
    console.error('Data quality issues error:', error);
    return res.status(500).json({ message: 'Unable to load data-quality issues.' });
  }
});

dataQualityRouter.get('/venues/search', async (req, res) => {
  try {
    const query = cleanText(req.query.q, 120);
    if (!query) return res.json([]);

    const venues = await knex('artists')
      .select('id', 'display_name', 'slug', 'home_region', 'venue_city', 'venue_state', 'profile_image', 'is_shell')
      .where({ profile_type: 'venue' })
      .whereNull('deleted_at')
      .limit(500);

    const results = venues
      .map((venue) => {
        const score = tokenSimilarity(query, venue.display_name, { removeVenueSuffixes: true });
        if (score < 0.42 && !String(venue.display_name || '').toLowerCase().includes(query.toLowerCase())) return null;
        return {
          ...venue,
          score: Number(Math.max(score, String(venue.display_name || '').toLowerCase().includes(query.toLowerCase()) ? 0.72 : 0).toFixed(3)),
          confidence: confidenceFromScore(score),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    return res.json(results);
  } catch (error) {
    console.error('Venue search error:', error);
    return res.status(500).json({ message: 'Unable to search venues.' });
  }
});

dataQualityRouter.get('/audit', async (req, res) => {
  try {
    const rows = await knex('data_quality_audit_logs as logs')
      .leftJoin('users as actor', 'logs.actor_user_id', 'actor.id')
      .select(
        'logs.*',
        'actor.email as actor_email',
        'actor.first_name as actor_first_name',
        'actor.last_name as actor_last_name'
      )
      .orderBy('logs.created_at', 'desc')
      .limit(100);
    return res.json(rows);
  } catch (error) {
    console.error('Audit log fetch error:', error);
    return res.status(500).json({ message: 'Unable to load audit logs.' });
  }
});

dataQualityRouter.post('/events/:eventId/attach-venue', async (req, res) => {
  const eventId = parsePositiveInt(req.params.eventId);
  const venueProfileId = parsePositiveInt(req.body?.venue_profile_id);
  if (!eventId || !venueProfileId) {
    return res.status(400).json({ message: 'Valid eventId and venue_profile_id are required.' });
  }

  try {
    const result = await knex.transaction(async (trx) => {
      const [event, venue] = await Promise.all([
        loadEvent(trx, eventId),
        loadVenue(trx, venueProfileId),
      ]);
      if (!event) return { error: 'event_not_found' };
      if (!venue) return { error: 'venue_not_found' };

      const previousValue = {
        venue_profile_id: event.venue_profile_id,
        venue_name: event.venue_name,
        raw_venue_name: event.raw_venue_name,
        region: event.region,
      };
      const updatePayload = {
        venue_profile_id: venue.id,
        venue_name: venue.display_name,
        raw_venue_name: event.raw_venue_name || event.venue_name || venue.display_name,
        venue_match_status: 'matched',
        venue_match_confidence: 'high',
        venue_match_source: 'admin_data_quality',
        venue_matched_at: trx.fn.now(),
        venue_matched_by: req.user?.id || null,
        updated_at: trx.fn.now(),
      };
      if (!event.region && venue.home_region) {
        updatePayload.region = normalizeRegion(venue.home_region);
      }
      if (!event.address && venue.venue_address) updatePayload.address = venue.venue_address;
      if (!event.website && venue.website) updatePayload.website = venue.website;

      const [updatedEvent] = await trx('events')
        .where({ id: eventId })
        .update(updatePayload)
        .returning('*');

      await writeAuditLog(trx, {
        actorUserId: req.user?.id,
        action: 'event_attach_venue',
        entityType: 'event',
        entityId: eventId,
        previousValue,
        newValue: {
          venue_profile_id: venue.id,
          venue_name: venue.display_name,
          region: updatePayload.region || event.region,
        },
      });

      return { event: updatedEvent };
    });

    if (result.error === 'event_not_found') return res.status(404).json({ message: 'Event not found.' });
    if (result.error === 'venue_not_found') return res.status(404).json({ message: 'Venue profile not found.' });
    return res.json(result);
  } catch (error) {
    console.error('Attach venue quick fix error:', error);
    return res.status(500).json({ message: 'Unable to attach venue profile.' });
  }
});

dataQualityRouter.post('/events/:eventId/attach-artist', async (req, res) => {
  const eventId = parsePositiveInt(req.params.eventId);
  const artistProfileId = parsePositiveInt(req.body?.artist_profile_id);
  if (!eventId || !artistProfileId) {
    return res.status(400).json({ message: 'Valid eventId and artist_profile_id are required.' });
  }

  try {
    const result = await knex.transaction(async (trx) => {
      const [event, artist] = await Promise.all([
        loadEvent(trx, eventId),
        trx('artists')
          .where({ id: artistProfileId, profile_type: 'artist' })
          .whereNull('deleted_at')
          .first(),
      ]);
      if (!event) return { error: 'event_not_found' };
      if (!artist) return { error: 'artist_not_found' };

      const previousValue = { artist_profile_id: event.artist_profile_id };
      const updatePayload = {
        artist_profile_id: event.artist_profile_id || artist.id,
        updated_at: trx.fn.now(),
      };
      const [updatedEvent] = await trx('events')
        .where({ id: eventId })
        .update(updatePayload)
        .returning('*');

      try {
        await trx('event_artists')
          .insert({
            event_id: eventId,
            artist_profile_id: artist.id,
            raw_artist_name: artist.display_name,
            billing_order: 0,
            role: 'performer',
            match_status: 'matched',
            match_confidence: 'high',
            is_headliner: true,
          })
          .onConflict(['event_id', 'artist_profile_id'])
          .ignore();
      } catch (error) {
        if (error?.code !== '42P01' && error?.code !== 'SQLITE_ERROR') throw error;
      }

      await writeAuditLog(trx, {
        actorUserId: req.user?.id,
        action: 'event_attach_artist',
        entityType: 'event',
        entityId: eventId,
        previousValue,
        newValue: { artist_profile_id: artist.id, artist_name: artist.display_name },
      });

      return { event: updatedEvent };
    });

    if (result.error === 'event_not_found') return res.status(404).json({ message: 'Event not found.' });
    if (result.error === 'artist_not_found') return res.status(404).json({ message: 'Artist profile not found.' });
    return res.json(result);
  } catch (error) {
    console.error('Attach artist quick fix error:', error);
    return res.status(500).json({ message: 'Unable to attach artist profile.' });
  }
});

dataQualityRouter.post('/events/:eventId/apply-venue-image', async (req, res) => {
  const eventId = parsePositiveInt(req.params.eventId);
  if (!eventId) return res.status(400).json({ message: 'Valid eventId is required.' });

  try {
    const result = await knex.transaction(async (trx) => {
      const event = await trx('events as e')
        .leftJoin('artists as venue', 'e.venue_profile_id', 'venue.id')
        .select('e.*', 'venue.profile_image as venue_profile_image')
        .where('e.id', eventId)
        .first();
      if (!event) return { error: 'event_not_found' };
      if (!isUsableImageValue(event.venue_profile_image)) return { error: 'venue_image_unavailable' };

      const previousValue = { poster: event.poster };
      const [updatedEvent] = await trx('events')
        .where({ id: eventId })
        .update({ poster: event.venue_profile_image, updated_at: trx.fn.now() })
        .returning('*');

      await writeAuditLog(trx, {
        actorUserId: req.user?.id,
        action: 'event_apply_venue_image',
        entityType: 'event',
        entityId: eventId,
        previousValue,
        newValue: { poster: event.venue_profile_image },
      });

      return { event: updatedEvent };
    });

    if (result.error === 'event_not_found') return res.status(404).json({ message: 'Event not found.' });
    if (result.error === 'venue_image_unavailable') return res.status(400).json({ message: 'Linked venue does not have a usable image.' });
    return res.json(result);
  } catch (error) {
    console.error('Apply venue image quick fix error:', error);
    return res.status(500).json({ message: 'Unable to apply venue image.' });
  }
});

dataQualityRouter.post('/events/:eventId/mark-reviewed', async (req, res) => {
  const eventId = parsePositiveInt(req.params.eventId);
  if (!eventId) return res.status(400).json({ message: 'Valid eventId is required.' });

  try {
    const [updatedEvent] = await knex('events')
      .where({ id: eventId })
      .update({
        data_quality_reviewed_at: knex.fn.now(),
        data_quality_reviewed_by: req.user?.id || null,
        updated_at: knex.fn.now(),
      })
      .returning('*');

    if (!updatedEvent) return res.status(404).json({ message: 'Event not found.' });

    await writeAuditLog(knex, {
      actorUserId: req.user?.id,
      action: 'event_mark_data_quality_reviewed',
      entityType: 'event',
      entityId: eventId,
    });

    return res.json({ event: updatedEvent });
  } catch (error) {
    console.error('Mark reviewed quick fix error:', error);
    return res.status(500).json({ message: 'Unable to mark event reviewed.' });
  }
});

dataQualityRouter.post('/venues/:venueId/aliases', async (req, res) => {
  const venueId = parsePositiveInt(req.params.venueId);
  const alias = cleanText(req.body?.alias, 255);
  if (!venueId || !alias) {
    return res.status(400).json({ message: 'Valid venueId and alias are required.' });
  }

  try {
    const venue = await loadVenue(knex, venueId);
    if (!venue) return res.status(404).json({ message: 'Venue profile not found.' });

    const normalizedAlias = canonicalVenueLookupName(alias) || normalizeEntityName(alias, { removeVenueSuffixes: true });
    const rows = await knex('venue_aliases')
      .insert({
        venue_profile_id: venueId,
        alias,
        normalized_alias: normalizedAlias,
        source: cleanText(req.body?.source, 80) || 'admin',
        confidence: req.body?.confidence ? Number(req.body.confidence) : 1,
        is_verified: req.body?.is_verified !== false,
        created_by: req.user?.id || null,
      })
      .onConflict(['normalized_alias', 'venue_profile_id'])
      .merge({
        alias,
        source: cleanText(req.body?.source, 80) || 'admin',
        confidence: req.body?.confidence ? Number(req.body.confidence) : 1,
        is_verified: req.body?.is_verified !== false,
        updated_at: knex.fn.now(),
      })
      .returning('*');

    const aliasRow = rows[0] || rows;
    await writeAuditLog(knex, {
      actorUserId: req.user?.id,
      action: 'venue_alias_upsert',
      entityType: 'venue',
      entityId: venueId,
      newValue: aliasRow,
    });

    return res.status(201).json({ alias: aliasRow });
  } catch (error) {
    console.error('Create venue alias error:', error);
    return res.status(500).json({ message: 'Unable to create venue alias.' });
  }
});

dataQualityRouter.post('/bulk', async (req, res) => {
  const action = String(req.body?.action || '');
  const eventIds = Array.isArray(req.body?.eventIds)
    ? [...new Set(req.body.eventIds.map(parsePositiveInt).filter(Boolean))]
    : [];

  if (!eventIds.length) return res.status(400).json({ message: 'Select at least one event.' });

  try {
    if (action === 'mark_reviewed') {
      const updated = await knex('events')
        .whereIn('id', eventIds)
        .update({
          data_quality_reviewed_at: knex.fn.now(),
          data_quality_reviewed_by: req.user?.id || null,
          updated_at: knex.fn.now(),
        })
        .returning('id');

      await writeAuditLog(knex, {
        actorUserId: req.user?.id,
        action: 'bulk_event_mark_data_quality_reviewed',
        entityType: 'event',
        metadata: { eventIds },
      });

      return res.json({ updatedCount: updated.length || eventIds.length, updatedIds: updated.map((row) => row.id || row) });
    }

    if (action === 'assign_region') {
      const region = normalizeRegion(req.body?.region);
      const updated = await knex('events')
        .whereIn('id', eventIds)
        .update({ region, updated_at: knex.fn.now() })
        .returning('id');

      await writeAuditLog(knex, {
        actorUserId: req.user?.id,
        action: 'bulk_event_assign_region',
        entityType: 'event',
        newValue: { region },
        metadata: { eventIds },
      });

      return res.json({ updatedCount: updated.length || eventIds.length, updatedIds: updated.map((row) => row.id || row) });
    }

    return res.status(400).json({ message: 'Unsupported bulk action.' });
  } catch (error) {
    console.error('Bulk data quality action error:', error);
    return res.status(500).json({ message: 'Unable to complete bulk action.' });
  }
});

module.exports = dataQualityRouter;
