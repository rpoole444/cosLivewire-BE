// models/Event.js
const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config);
 // Adjust the path as necessary for your project structure

const createEvent = async (eventData) => {
  return knex('events').insert(eventData).returning('*'); // Assuming PostgreSQL for returning inserted row
};

const getEventsForReview = async () => {
  // 1) Perform a left join on "users" to include user fields
  const events = await knex('events')
    .leftJoin('users', 'events.user_id', 'users.id')
    .where('events.is_approved', false)
    .select(
      'events.*',
      'users.first_name as user_first_name',
      'users.last_name as user_last_name',
      'users.email as user_email'
    );

  // 2) Map over these rows to create a nested "user" object
  const shapedEvents = events.map((row) => ({
    ...row,
    user: {
      first_name: row.user_first_name,
      last_name: row.user_last_name,
      email: row.user_email
    }
  }));

  // 3) Clean up the flattened fields
  shapedEvents.forEach((event) => {
    delete event.user_first_name;
    delete event.user_last_name;
    delete event.user_email;
  });

  return shapedEvents;
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

const updateEvent = async(eventId, eventData) => {
  return knex('events')
    .where({ id: eventId })
    .update(eventData)
    .returning('*');
}

const findEventById = (eventId) => {
  return knex('events').where({ id: eventId }).first();
}

const deleteEvent = async (eventId) => {
  return knex('events')
    .where({ id: eventId })
    .del(); // This will delete the event
};

module.exports = {
  updateEvent,
  createEvent,
  getEventsForReview,
  updateEventStatus,
  getAllEvents,
  findEventById,
  deleteEvent
}
