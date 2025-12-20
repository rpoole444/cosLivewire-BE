const express = require('express');
const dayjs = require('dayjs');
const { parseMoondogCalendar } = require('../utils/parseMoondogCalendar');
const { requireAdmin } = require('../middleware/auth');

const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config);

const importsRouter = express.Router();

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

importsRouter.post('/moondog', async (req, res) => {
  try {
    const { raw_text } = req.body;
    if (!raw_text || typeof raw_text !== 'string') {
      return res.status(400).json({ message: 'raw_text is required' });
    }

    const promoterEnv = process.env.MOONDOG_PROMOTER_ID;
    const promoterId = promoterEnv && Number.isInteger(Number(promoterEnv))
      ? Number(promoterEnv)
      : null;
    if (!promoterId) {
      console.warn('promoter_unassigned');
    }

    const parsedEvents = parseMoondogCalendar(raw_text);
    const warningCount = countWarnings(parsedEvents);

    const batchId = await knex.transaction(async (trx) => {
      const insertedBatch = await trx('import_batches')
        .insert({
          source: 'moondog',
          raw_text,
          created_by_user_id: req.user?.id || null,
        })
        .returning('id');

      const resolvedBatchId = normalizeInsertedId(insertedBatch);

      const rows = parsedEvents.map((event) => ({
        batch_id: resolvedBatchId,
        status: 'pending',
        promoter_id: promoterId,
        source: 'moondog',
        venue_name: event.venue_name,
        artist_display: event.artist_display,
        start_at: event.start_at,
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

      const defaultPosters = {
        // Apply defaults only during promotion, and only for trusted sources.
        moondog: 'https://alpinegg-posters.s3.us-east-2.amazonaws.com/promoters/moondog-music-shop.png',
      };

      for (const event of acceptedEvents) {
        // Derive date/time from start_at to guarantee NOT NULL events.date.
        const startAt = event.start_at ? dayjs(event.start_at) : null;
        const finalDate = event.date || (startAt ? startAt.format('YYYY-MM-DD') : null);
        if (!finalDate) {
          throw new Error(`Missing date for import_event ${event.id}`);
        }

        const finalStartTime = event.start_time || (startAt ? startAt.format('HH:mm:ss') : null);

        const normalizedPoster = event.poster && String(event.poster).trim();
        const poster = normalizedPoster
          ? normalizedPoster
          : (defaultPosters[source] || null);

        const rows = await trx('events')
          .insert({
            user_id: event.user_id || batch.created_by_user_id || null,
            title: event.title || event.artist_display || 'Untitled Event',
            description: event.description || '',
            location: event.location || event.venue_name || '',
            address: event.address || '',
            date: finalDate,
            genre: event.genre || null,
            ticket_price: null,
            age_restriction: null,
            website_link: null,
            is_approved: true,
            venue_name: event.venue_name || null,
            website: event.website || null,
            poster,
            start_time: finalStartTime,
            end_time: event.end_time || null,
          })
          .returning('id');

        const promotedEventId = Array.isArray(rows) ? rows[0]?.id || rows[0] : rows;

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
        promoted_count: acceptedEvents.length,
        skipped_count: totalCount - acceptedEvents.length,
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
importsRouter.post('/:source/events/:eventId/accept', requireAdmin, async (req, res) => {
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

      if (event.status !== 'pending') {
        return { error: 'Event is not pending' };
      }

      const rows = await trx('import_events')
        .where({ id: eventId })
        .update({
          status: 'accepted',
          accepted_by: req.user?.id || null,
          accepted_at: knex.fn.now(),
        })
        .returning('*');

      return rows[0];
    });

    if (!updatedEvent) {
      return res.status(404).json({ message: 'Import event not found' });
    }
    if (updatedEvent.error) {
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

importsRouter.post('/:source/events/:eventId/reject', requireAdmin, async (req, res) => {
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

      if (event.status !== 'pending') {
        return { error: 'Event is not pending' };
      }

      const rows = await trx('import_events')
        .where({ id: eventId })
        .update({
          status: 'rejected',
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

importsRouter.get('/moondog/:batchId', async (req, res) => {
  try {
    const batchId = Number(req.params.batchId);
    if (!Number.isInteger(batchId)) {
      return res.status(400).json({ message: 'batchId must be an integer' });
    }

    const batch = await knex('import_batches')
      .where({ id: batchId, source: 'moondog' })
      .first();
    if (!batch) {
      return res.status(404).json({ message: 'Import batch not found' });
    }

    const events = await knex('import_events')
      .where({ batch_id: batchId, source: 'moondog' })
      .orderBy('id');

    return res.json({
      batch,
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
