const express = require('express');
const { deleteEvent, findEventById, createEvent, getAllEvents, getEventsForReview, updateEventStatus, updateEvent } = require('../models/Event');

const eventRouter = express.Router();

// Submit event
eventRouter.post('/submit', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  try {
    const eventData = {
      ...req.body,
      user_id: req.user.id
    };

    const event = await createEvent(eventData);
    res.status(201).json({ event: event[0], message: 'Event submitted successfully.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Fetch events pending review
eventRouter.get('/review', async (req, res) => {
  try {
    const events = await getEventsForReview();
    res.json(events);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Update event status (approve/deny)
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

// Edit/update event data
eventRouter.put('/:eventId', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  
  const { eventId } = req.params;
  const eventData = req.body;

  try {
    const updatedEvent = await updateEvent(eventId, eventData);
    if (updatedEvent.length === 0) {
      return res.status(404).json({ message: 'Event not found' });
    }

    res.json({ event: updatedEvent[0], message: 'Event updated successfully.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// GET Single Event
eventRouter.get('/:eventId', async (req, res) => {
  const { eventId } = req.params;
  try {
    const event = await findEventById(eventId);
    res.json(event);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET All Events
eventRouter.get('/', async (req, res) => {
  try {
    const events = await getAllEvents();
    res.json(events);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE event by ID
eventRouter.delete('/:eventId', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  const { eventId } = req.params;

  try {
    const deleteResult = await deleteEvent(eventId);

    if (deleteResult) {
      res.status(204).send();
    } else {
      res.status(404).json({ message: 'Event not found' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = eventRouter;
