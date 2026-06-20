const express = require('express');
const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config);
const multer = require('multer');
const multerS3 = require('multer-s3');
const { S3Client } = require('@aws-sdk/client-s3');
const { fromEnv } = require('@aws-sdk/credential-provider-env');
const { v4: uuidv4 } = require('uuid');
const { sendEventReceiptEmail, sendEventApprovedEmail } = require("../models/mailer");
const { findUserById } = require("../models/User");   // add this line
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const slugify = require("../utils/slugify")
const generateUniqueSlug = require('../utils/generateUniqueSlug');
const isAdmin = require('../utils/isAdmin');
const { hasProAccess } = require('../utils/access');
const { normalizeRegion } = require('../utils/regions');
const { findVenueProfileIdByInput } = require('../utils/venueProfiles');

const {
  deleteEvent,
  findEventById,
  createEvent,
  createRecurringEvents,
  getAllEvents,
  getEventsForReview,
  updateEventStatus,
  updateEvent,
  findBySlug
} = require('../models/Event');

// AWS S3 setup
const s3 = new S3Client({
  credentials: fromEnv(),
  region: process.env.AWS_REGION,
});

const upload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.AWS_S3_BUCKET_NAME,
    metadata: (req, file, cb) => cb(null, { fieldName: file.fieldname }),
    key: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
});

const eventRouter = express.Router();

const canEditEvent = (event, user) => {
  if (!event || !user) return false;
  if (user.is_admin) return true;
  if (event.user_id === user.id) return true;
  return Number(event.claimed_artist_user_id) === Number(user.id);
};

const canDeleteEvent = (event, user) => {
  if (!event || !user) return false;
  return user.is_admin || event.user_id === user.id;
};

const isGenericImportedPoster = (event) => {
  return Boolean(event?.source && event?.poster);
};

/**
 * Submit event (single or recurring)
 */
eventRouter.post('/submit', upload.single('poster'), async (req, res) => {
  if (!req.isAuthenticated?.()) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  try {
    const {
      user_id,
      title,
      description,
      location,
      address,
      date,
      genre,
      age_restriction,
      website_link,
      venue_name,
      venue_profile_id,
      website,
      region,
      start_time,
      end_time,
      recurrenceDates,
      slug: providedSlug,
    } = req.body;

    // poster URL (or null)
    const posterUrl = req.file ? req.file.location : null;

    // 💵 normalise ticket price
    let { ticket_price } = req.body;
    if (typeof ticket_price === 'string') {
      ticket_price = parseFloat(ticket_price.replace(/[^\d.]/g, ''));
    }
    if (isNaN(ticket_price)) ticket_price = null;
    const slug = providedSlug || await generateUniqueSlug(title);
    const resolvedVenueProfileId = await findVenueProfileIdByInput(knex, {
      venueProfileId: venue_profile_id,
      venueName: venue_name,
    });

    const baseEventData = {
      user_id,
      title,
      description,
      location,
      address,
      genre,
      ticket_price,
      age_restriction,
      website_link,
      venue_name,
      venue_profile_id: resolvedVenueProfileId,
      website,
      region: normalizeRegion(region),
      start_time,
      end_time,
      slug,
      poster: posterUrl,
    };

    // ---------- insert ----------
    let insertedEvents;
    if (recurrenceDates) {
      const parsed = JSON.parse(recurrenceDates);
      insertedEvents = await createRecurringEvents(baseEventData, parsed);
    } else {
      insertedEvents = await createEvent({ ...baseEventData, date });
    }

    // ---------- e‑mail receipt ----------
    try {
      const firstEvent  = Array.isArray(insertedEvents) ? insertedEvents[0] : insertedEvents;
      await sendEventReceiptEmail(firstEvent, req.user.email);
    } catch (mailErr) {
      console.error('Receipt e‑mail failed:', mailErr);
      // do NOT return 500 – the event is saved; just log
    }

    res.status(201).json({
      events: Array.isArray(insertedEvents) ? insertedEvents : [insertedEvents],
      message: 'Event(s) submitted successfully.',
    });
  } catch (error) {
    console.error('Error submitting event(s):', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

/**
 * Submit multiple events in a single request
 */
eventRouter.post('/submit-multiple', upload.array('posters'), async (req, res) => {
  if (!req.isAuthenticated?.()) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  const canSubmitMultiple = await hasProAccess(req.user.id);
  if (!canSubmitMultiple) {
    return res.status(403).json({ message: 'Artist profile access required for multiple event submission.' });
  }

  try {
    const eventsPayload = req.body.events ? JSON.parse(req.body.events) : [];
    const files = req.files || [];

    if (!Array.isArray(eventsPayload) || eventsPayload.length === 0) {
      return res.status(400).json({ message: 'No events provided' });
    }

    const insertedAll = [];
    for (let i = 0; i < eventsPayload.length; i++) {
      const event = eventsPayload[i];
      const posterFile = files[i];

      let {
        user_id,
        title,
        description,
        location,
        address,
        date,
        genre,
        age_restriction,
        website_link,
        venue_name,
        venue_profile_id,
        website,
        region,
        start_time,
        end_time,
        ticket_price,
        recurrenceDates,
        slug: providedSlug,
      } = event;

      const posterUrl = posterFile ? posterFile.location : null;

      if (typeof ticket_price === 'string') {
        ticket_price = parseFloat(ticket_price.replace(/[^\d.]/g, ''));
      }
      if (isNaN(ticket_price)) ticket_price = null;

      const slug = providedSlug || await generateUniqueSlug(title);
      const resolvedVenueProfileId = await findVenueProfileIdByInput(knex, {
        venueProfileId: venue_profile_id,
        venueName: venue_name,
      });

      const baseEventData = {
        user_id,
        title,
        description,
        location,
        address,
        genre,
        ticket_price,
        age_restriction,
        website_link,
        venue_name,
        venue_profile_id: resolvedVenueProfileId,
        website,
        region: normalizeRegion(region),
        start_time,
        end_time,
        slug,
        poster: posterUrl,
      };

      let insertedEvents;
      if (recurrenceDates) {
        const parsed = Array.isArray(recurrenceDates)
          ? recurrenceDates
          : JSON.parse(recurrenceDates);
        insertedEvents = await createRecurringEvents(baseEventData, parsed);
      } else {
        insertedEvents = await createEvent({ ...baseEventData, date });
      }

      insertedAll.push(
        ...(Array.isArray(insertedEvents) ? insertedEvents : [insertedEvents])
      );
    }

    try {
      if (insertedAll[0]) {
        await sendEventReceiptEmail(insertedAll[0], req.user.email);
      }
    } catch (mailErr) {
      console.error('Receipt e‑mail failed:', mailErr);
    }

    res.status(201).json({
      events: insertedAll,
      message: 'Event(s) submitted successfully.',
    });
  } catch (error) {
    console.error('Error submitting event(s):', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});


/**
 * Fetch events pending review
 */
eventRouter.get('/review', isAdmin, async (req, res) => {
  try {
    const events = await getEventsForReview();
    res.json(events);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

/**
 * Update event status (approve/deny)
 */
eventRouter.put('/review/:eventId', isAdmin, async (req, res) => {
  try {
    const { eventId }  = req.params;
    const { isApproved } = req.body;

    const updatedEventArr = await updateEventStatus(eventId, isApproved);
    const updatedEvent    = updatedEventArr[0];

    // ---------- e‑mail only when approved ----------
    if (isApproved) {
      try {
        const owner = await findUserById(updatedEvent.user_id);
        if (owner?.email) {
          await sendEventApprovedEmail(updatedEvent, owner.email);
        }
      } catch (mailErr) {
        console.error('Approval e‑mail failed:', mailErr);
        // keep going – approval itself succeeded
      }
    }

    res.json({ event: updatedEvent, message: 'Event status updated successfully.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

eventRouter.get('/admin/summary', isAdmin, async (req, res) => {
  try {
    const [
      pendingEvents,
      pendingProfiles,
      pendingClaims,
      recentApprovedEvents,
      recentImports,
    ] = await Promise.all([
      knex('events').where({ is_approved: false }).count({ count: '*' }).first(),
      knex('artists').where({ is_approved: false }).whereNull('deleted_at').count({ count: '*' }).first(),
      knex('event_claim_requests').where({ status: 'pending' }).count({ count: '*' }).first(),
      knex('events')
        .select('id', 'title', 'slug', 'date', 'start_time', 'venue_name', 'region', 'updated_at', 'source_label')
        .where({ is_approved: true })
        .orderBy('updated_at', 'desc')
        .limit(6),
      knex('import_batches as ib')
        .leftJoin('import_events as ie', 'ie.batch_id', 'ib.id')
        .select(
          'ib.id',
          'ib.source',
          'ib.status',
          'ib.created_at',
          'ib.completed_at',
          knex.raw('COUNT(ie.id)::int as event_count'),
          knex.raw("COUNT(*) FILTER (WHERE ie.status = 'pending')::int as pending_count"),
          knex.raw("COUNT(*) FILTER (WHERE ie.status = 'accepted')::int as accepted_count"),
          knex.raw("COUNT(*) FILTER (WHERE ie.status = 'rejected')::int as rejected_count")
        )
        .groupBy('ib.id')
        .orderBy('ib.created_at', 'desc')
        .limit(6),
    ]);

    const toNumber = (row) => Number(row?.count || 0);

    return res.json({
      counts: {
        pending_events: toNumber(pendingEvents),
        pending_profiles: toNumber(pendingProfiles),
        pending_claims: toNumber(pendingClaims),
      },
      recent_approved_events: recentApprovedEvents,
      recent_imports: recentImports,
      quick_links: [
        { label: 'Public calendar', href: '/' },
        { label: 'Artist directory', href: '/artists' },
        { label: 'Venue directory', href: '/venues/colorado-springs' },
        { label: 'Import Moondog', href: '/admin/import' },
      ],
    });
  } catch (error) {
    console.error('Error loading admin summary:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

eventRouter.get('/claims/review', isAdmin, async (req, res) => {
  try {
    const claims = await knex('event_claim_requests as ecr')
      .join('events as e', 'ecr.event_id', 'e.id')
      .join('artists as a', 'ecr.artist_profile_id', 'a.id')
      .join('users as u', 'ecr.requested_by_user_id', 'u.id')
      .leftJoin('artists as existing_artist', 'e.artist_profile_id', 'existing_artist.id')
      .select(
        'ecr.*',
        'e.title as event_title',
        'e.slug as event_slug',
        'e.date as event_date',
        'e.start_time as event_start_time',
        'e.venue_name as event_venue_name',
        'e.source as event_source',
        'e.source_label as event_source_label',
        'e.poster as event_poster',
        'e.artist_profile_id as current_artist_profile_id',
        'a.display_name as artist_display_name',
        'a.slug as artist_slug',
        'a.profile_type as artist_profile_type',
        'u.first_name as requester_first_name',
        'u.last_name as requester_last_name',
        'u.email as requester_email',
        'existing_artist.display_name as current_artist_display_name'
      )
      .where('ecr.status', 'pending')
      .orderBy('ecr.created_at', 'asc');

    return res.json(claims);
  } catch (error) {
    console.error('Error loading event claim requests:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

eventRouter.put('/claims/:claimId/review', isAdmin, async (req, res) => {
  try {
    const { claimId } = req.params;
    const approve = req.body?.approve === true;
    const adminNotes = req.body?.admin_notes || null;

    const claim = await knex('event_claim_requests')
      .where({ id: claimId })
      .first();

    if (!claim) return res.status(404).json({ message: 'Claim request not found.' });
    if (claim.status !== 'pending') {
      return res.status(400).json({ message: 'This claim request has already been reviewed.' });
    }

    const result = await knex.transaction(async (trx) => {
      const event = await trx('events')
        .where({ id: claim.event_id })
        .first();

      if (!event) throw new Error('event_missing');

      if (approve && event.artist_profile_id && Number(event.artist_profile_id) !== Number(claim.artist_profile_id)) {
        throw new Error('event_already_claimed');
      }

      const status = approve ? 'approved' : 'rejected';
      const [reviewedClaim] = await trx('event_claim_requests')
        .where({ id: claim.id })
        .update({
          status,
          reviewed_by_user_id: req.user.id,
          reviewed_at: trx.fn.now(),
          admin_notes: adminNotes,
          updated_at: trx.fn.now(),
        })
        .returning('*');

      let updatedEvent = event;
      if (approve) {
        [updatedEvent] = await trx('events')
          .where({ id: claim.event_id })
          .update({
            artist_profile_id: claim.artist_profile_id,
            claimed_by_user_id: claim.requested_by_user_id,
            claimed_at: trx.fn.now(),
            last_edited_by_user_id: req.user.id,
            updated_at: trx.fn.now(),
          })
          .returning('*');

        await trx('event_claim_requests')
          .where({ event_id: claim.event_id, status: 'pending' })
          .whereNot({ id: claim.id })
          .update({
            status: 'rejected',
            reviewed_by_user_id: req.user.id,
            reviewed_at: trx.fn.now(),
            admin_notes: 'Another claim was approved for this event.',
            updated_at: trx.fn.now(),
          });
      }

      return { claim: reviewedClaim, event: updatedEvent };
    });

    return res.json({
      ...result,
      message: approve
        ? 'Claim approved. The artist can now edit this event.'
        : 'Claim rejected.',
    });
  } catch (error) {
    if (error.message === 'event_missing') {
      return res.status(404).json({ message: 'Event not found.' });
    }
    if (error.message === 'event_already_claimed') {
      return res.status(409).json({ message: 'This event is already claimed by another artist profile.' });
    }
    console.error('Error reviewing event claim:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

/**
 * Claim an imported/promoter/venue-created event for an artist profile.
 * Claiming creates an admin-reviewed request. Approval attaches the event and grants edit access.
 */
eventRouter.post('/:eventId/claim', async (req, res) => {
  if (!req.isAuthenticated?.()) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  try {
    const { eventId } = req.params;
    const artistProfileId = Number(req.body.artist_profile_id);

    if (!Number.isInteger(artistProfileId)) {
      return res.status(400).json({ message: 'Choose an artist profile to claim this event.' });
    }

    const event = await findEventById(eventId);
    if (!event) return res.status(404).json({ message: 'Event not found' });

    const artistProfile = await knex('artists')
      .select('id', 'user_id', 'display_name', 'slug', 'profile_type', 'is_approved', 'deleted_at')
      .where({ id: artistProfileId })
      .first();

    if (!artistProfile || artistProfile.deleted_at) {
      return res.status(404).json({ message: 'Artist profile not found.' });
    }

    if (artistProfile.profile_type && artistProfile.profile_type !== 'artist' && !req.user.is_admin) {
      return res.status(400).json({ message: 'Choose an artist profile to claim this event.' });
    }

    if (artistProfile.user_id !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ message: 'Not authorized to claim for this artist profile.' });
    }

    if (event.artist_profile_id && Number(event.artist_profile_id) !== artistProfileId) {
      return res.status(409).json({
        message: 'This event is already claimed by another artist profile.',
        claimed_artist: event.claimed_artist || null,
      });
    }

    if (Number(event.artist_profile_id) === artistProfileId) {
      return res.status(409).json({
        message: 'This event is already connected to that artist profile.',
        event,
      });
    }

    const existingRequest = await knex('event_claim_requests')
      .where({
        event_id: eventId,
        artist_profile_id: artistProfileId,
      })
      .first();

    if (existingRequest) {
      if (existingRequest.status === 'pending') {
        return res.status(409).json({
          message: 'This claim request is already waiting for admin review.',
          claim: existingRequest,
        });
      }
      if (existingRequest.status === 'approved') {
        return res.status(409).json({
          message: 'This event is already connected to that artist profile.',
          claim: existingRequest,
        });
      }
    }

    const [claim] = await knex('event_claim_requests')
      .insert({
        event_id: eventId,
        artist_profile_id: artistProfileId,
        requested_by_user_id: req.user.id,
        status: 'pending',
      })
      .onConflict(['event_id', 'artist_profile_id'])
      .merge({
        requested_by_user_id: req.user.id,
        status: 'pending',
        reviewed_by_user_id: null,
        reviewed_at: null,
        admin_notes: null,
        updated_at: knex.fn.now(),
      })
      .returning('*');

    return res.json({
      claim,
      event,
      message: 'Claim request sent for admin review.',
      prompt: 'Your claim request was sent. Once an admin approves it, this event will appear on your artist profile and you will be able to edit the full listing.',
      image_hint: isGenericImportedPoster(event)
        ? 'This event is using a generic promoter image. Add an artist photo or show poster after the claim is approved.'
        : null,
    });
  } catch (error) {
    console.error('Error claiming event:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

eventRouter.delete('/:eventId/claim', isAdmin, async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await findEventById(eventId);
    if (!event) return res.status(404).json({ message: 'Event not found' });

    const [updatedEvent] = await knex('events')
      .where({ id: eventId })
      .update({
        artist_profile_id: null,
        claimed_by_user_id: null,
        claimed_at: null,
        last_edited_by_user_id: req.user.id,
        updated_at: knex.fn.now(),
      })
      .returning('*');

    return res.json({ event: updatedEvent, message: 'Event claim removed.' });
  } catch (error) {
    console.error('Error removing event claim:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

/**
 * Edit/update event data
 */
eventRouter.put('/:eventId', upload.single('poster'), async (req, res) => {
  if (!req.isAuthenticated?.()) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  try {
    const { eventId } = req.params;
    const event = await findEventById(eventId);
    if (!event) return res.status(404).json({ message: 'Event not found' });

    // 🔐 Auth check
    if (!canEditEvent(event, req.user)) {
      return res.status(403).json({ message: 'Not authorized to edit this event' });
    }

    let poster = event.poster;

    // ✅ Delete old poster if a new one is uploaded
    if (req.file) {
      // Parse old poster key from S3 URL
      if (poster) {
        const oldKey = poster.split('/').pop(); // Get filename from URL
        try {
          await s3.send(new DeleteObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET_NAME,
            Key: oldKey,
          }));
          console.log(`Deleted old poster from S3: ${oldKey}`);
        } catch (err) {
          console.error('Failed to delete old poster from S3:', err);
        }
      }

      // Set new poster URL
      poster = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${req.file.key}`;
    }

    const {
      title,
      description,
      location,
      date,
      start_time,
      end_time,
      genre,
      ticket_price,
      age_restriction,
      website_link,
      venue_name,
      venue_profile_id,
      website,
      address,
      region,
    } = req.body;

    const resolvedVenueProfileId = await findVenueProfileIdByInput(knex, {
      venueProfileId: venue_profile_id,
      venueName: venue_name,
    });

    const sanitizedPayload = {
      title,
      description,
      location,
      date,
      start_time,
      end_time,
      genre,
      ticket_price: ticket_price === '' ? null : ticket_price,
      age_restriction,
      website_link,
      venue_name,
      venue_profile_id: resolvedVenueProfileId,
      website,
      address,
      region: normalizeRegion(region || event.region),
      poster,
      last_edited_by_user_id: req.user.id,
      updated_at: knex.fn.now(),
    };

    const updatedEvent = await updateEvent(eventId, sanitizedPayload);

    res.json({
      event: {
        ...updatedEvent[0],
        can_edit_event: true,
      },
      message: 'Event updated successfully.',
    });

  } catch (error) {
    console.error('Error updating event:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * Get single event by ID
 */
eventRouter.get('/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await findEventById(eventId);
    if (!event) return res.status(404).json({ message: 'Event not found' });
    res.json({
      ...event,
      can_edit_event: canEditEvent(event, req.user),
      can_delete_event: canDeleteEvent(event, req.user),
      uses_generic_imported_poster: isGenericImportedPoster(event),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

/**
 * Get all events
 */
eventRouter.get('/', async (req, res) => {
  try {
    const events = await getAllEvents({ region: req.query.region });
    res.json(events);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

eventRouter.get('/slug/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const event = await findBySlug(slug);
    if (!event) return res.status(404).json({ message: 'Event not found' });
    res.json({
      ...event,
      can_edit_event: canEditEvent(event, req.user),
      can_delete_event: canDeleteEvent(event, req.user),
      uses_generic_imported_poster: isGenericImportedPoster(event),
    });
  } catch (err) {
    console.error('Error fetching event by slug:', err);
    res.status(500).json({ message: 'Server error' });
  }
});



/**
 * Delete event
 */
eventRouter.delete('/:eventId', async (req, res) => {
  if (!req.isAuthenticated?.()) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  try {
    const { eventId } = req.params;
    const event = await findEventById(eventId);
    if (!event) return res.status(404).json({ message: 'Event not found' });
    if (!canDeleteEvent(event, req.user)) {
      return res.status(403).json({ message: 'Not authorized to delete this event' });
    }

    const result = await deleteEvent(eventId);

    if (result) {
      res.status(204).send();
    } else {
      res.status(404).json({ message: 'Event not found' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

module.exports = eventRouter;
