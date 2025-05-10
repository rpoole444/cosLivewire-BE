const express = require('express');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { S3Client } = require('@aws-sdk/client-s3');
const { fromEnv } = require('@aws-sdk/credential-provider-env');
const { v4: uuidv4 } = require('uuid');

const {
  deleteEvent,
  findEventById,
  createEvent,
  createRecurringEvents,
  getAllEvents,
  getEventsForReview,
  updateEventStatus,
  updateEvent,
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
      ticket_price,
      age_restriction,
      website_link,
      venue_name,
      website,
      start_time,
      end_time,
      recurrenceDates,
    } = req.body;

    const posterUrl = req.file ? req.file.location : null;

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
      poster: posterUrl,
    };

    let insertedEvents;

    if (recurrenceDates) {
      const parsedDates = JSON.parse(recurrenceDates);
      insertedEvents = await createRecurringEvents(baseEventData, parsedDates);
    } else {
      insertedEvents = await createEvent({ ...baseEventData, date });
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
    const { eventId } = req.params;
    const { isApproved } = req.body;
    const updatedEvent = await updateEventStatus(eventId, isApproved);
    res.json({ event: updatedEvent[0], message: 'Event status updated successfully.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

/**
 * Edit/update event data
 */
eventRouter.put('/:eventId', async (req, res) => {
  if (!req.isAuthenticated?.()) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  try {
    const { eventId } = req.params;
    const updatedEvent = await updateEvent(eventId, req.body);

    if (updatedEvent.length === 0) {
      return res.status(404).json({ message: 'Event not found' });
    }

    res.json({ event: updatedEvent[0], message: 'Event updated successfully.' });
  } catch (error) {
    console.error(error);
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
