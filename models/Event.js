// models/Event.js
const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config);
 // Adjust the path as necessary for your project structure

const createEvent = async (eventData) => {
  return knex('events').insert(eventData).returning('*'); // Assuming PostgreSQL for returning inserted row
};

const getEventsForReview = () => {
  return knex('events').where({ is_approved: false });
};

const updateEventStatus = (eventId, isApproved) => {
  return knex('events')
    .where({ id: eventId })
    .update({ is_approved: isApproved })
    .returning('*'); // For PostgreSQL to return the updated row
};

const getAllEvents = async () => {
  return knex('events').select('*');
};

module.exports = {
  createEvent,
  getEventsForReview,
  updateEventStatus,
  getAllEvents
};
