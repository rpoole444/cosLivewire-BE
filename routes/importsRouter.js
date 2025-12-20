const express = require('express');
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
