const express = require('express');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { S3Client } = require('@aws-sdk/client-s3');
const { fromEnv } = require('@aws-sdk/credential-provider-env');
const { v4: uuidv4 } = require('uuid');
const { sendEventReceiptEmail, sendEventApprovedEmail } = require("../models/mailer");
const { findUserById } = require("../models/User");   // add this line
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const slugify = require("../utils/slugify")

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
      website,
      start_time,
      end_time,
      recurrenceDates,
    } = req.body;

    // poster URL (or null)
    const posterUrl = req.file ? req.file.location : null;

    // 💵 normalise ticket price
    let { ticket_price } = req.body;
    if (typeof ticket_price === 'string') {
      ticket_price = parseFloat(ticket_price.replace(/[^\d.]/g, ''));
    }
    if (isNaN(ticket_price)) ticket_price = null;
    const slug = `${slugify(title)}-${Date.now().toString(36)}`;

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
      website,
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
 * Fetch events pending review
 */
eventRouter.get('/review', async (req, res) => {
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
eventRouter.put('/review/:eventId', async (req, res) => {
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
    if (event.user_id !== req.user.id && !req.user.is_admin) {
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
      website,
      address,
    } = req.body;

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
      website,
      address,
      poster,
    };

    const updatedEvent = await updateEvent(eventId, sanitizedPayload);

    res.json({ event: updatedEvent[0], message: 'Event updated successfully.' });

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
    res.json(event);
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
    const events = await getAllEvents();
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
    res.json(event);
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
