// models/Event.js
const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config);
const { v4: uuidv4 } = require('uuid');
const slugify = require('../utils/slugify');
const { REGION_ALL, REGION_SLUGS } = require('../utils/regions');
const {
  attachEventImageFields,
  attachEventImageFieldsToMany,
  enrichEventsWithVenueProfilesByName,
} = require('../utils/eventImages');

 // Adjust the path as necessary for your project structure

const createEvent = async (eventData) => {
  return knex('events').insert(eventData).returning('*'); // Assuming PostgreSQL for returning inserted row
};

const createRecurringEvents = async (baseEventData, recurrenceDates) => {
  const recurring_group_id = uuidv4();
  const baseSlug = baseEventData.slug || slugify(baseEventData.title);

  const eventsToInsert = recurrenceDates.map((recurrenceDate) => ({
    ...baseEventData,
    date: recurrenceDate,
    recurring_group_id,
    slug: `${baseSlug}-${uuidv4()}`,
  }));

  return knex('events').insert(eventsToInsert).returning('*');
};

const loadVenueProfilesForImageFallback = async () => {
  return knex('artists')
    .select(
      'id',
      'user_id',
      'display_name',
      'slug',
      'profile_image',
      'website',
      'venue_address',
      'venue_city',
      'venue_state',
      'venue_postal_code'
    )
    .where({ profile_type: 'venue' })
    .whereNull('deleted_at');
};

const applyDynamicVenueImageFallback = async (events = []) => {
  if (!events.length) return events;
  const needsVenueLookup = events.some((event) =>
    !event.venue_profile_image && String(event.venue_name || event.location || '').trim()
  );
  if (!needsVenueLookup) return events;
  const venues = await loadVenueProfilesForImageFallback();
  return enrichEventsWithVenueProfilesByName(events, venues);
};


const getEventsForReview = async () => {
  // 1) Perform a left join on "users" to include user fields
  const events = await knex('events')
    .leftJoin('users', 'events.user_id', 'users.id')
    .leftJoin('artists as venue_profile', 'events.venue_profile_id', 'venue_profile.id')
    .leftJoin('artists as claimed_artist', 'events.artist_profile_id', 'claimed_artist.id')
    .leftJoin('users as claimed_user', 'events.claimed_by_user_id', 'claimed_user.id')
    .where('events.is_approved', false)
    .select(
      'events.*',
      'venue_profile.profile_image as venue_profile_image',
      'venue_profile.display_name as venue_profile_display_name',
      'venue_profile.slug as venue_profile_slug',
      'venue_profile.user_id as venue_profile_user_id',
      'venue_profile.website as venue_profile_website',
      'venue_profile.venue_address as venue_profile_address',
      'venue_profile.venue_city as venue_profile_city',
      'venue_profile.venue_state as venue_profile_state',
      'venue_profile.venue_postal_code as venue_profile_postal_code',
      'users.first_name as user_first_name',
      'users.last_name as user_last_name',
      'users.email as user_email',
      'claimed_artist.display_name as claimed_artist_display_name',
      'claimed_artist.slug as claimed_artist_slug',
      'claimed_artist.profile_type as claimed_artist_profile_type',
      'claimed_artist.user_id as claimed_artist_user_id',
      'claimed_artist.website as claimed_artist_website',
      'claimed_user.email as claimed_by_user_email'
    );

  // 2) Map over these rows to create a nested "user" object
  const eventsWithVenueFallbacks = await applyDynamicVenueImageFallback(events);
  const shapedEvents = eventsWithVenueFallbacks.map((row) => attachEventImageFields({
    ...row,
    user: {
      first_name: row.user_first_name,
      last_name: row.user_last_name,
      email: row.user_email
    },
    claimed_artist: row.artist_profile_id ? {
      id: row.artist_profile_id,
      display_name: row.claimed_artist_display_name,
      slug: row.claimed_artist_slug,
      profile_type: row.claimed_artist_profile_type,
      user_id: row.claimed_artist_user_id,
      website: row.claimed_artist_website,
    } : null,
    claimed_by_user_email: row.claimed_by_user_email,
  }));

  // 3) Clean up the flattened fields
  shapedEvents.forEach((event) => {
    delete event.user_first_name;
    delete event.user_last_name;
    delete event.user_email;
    delete event.claimed_artist_display_name;
    delete event.claimed_artist_slug;
    delete event.claimed_artist_profile_type;
    delete event.claimed_artist_user_id;
    delete event.claimed_artist_website;
  });

  return shapedEvents;
};


const updateEventStatus = (eventId, isApproved) => {
  return knex('events')
    .where({ id: eventId })
    .update({ is_approved: isApproved })
    .returning('*'); // For PostgreSQL to return the updated row
};

const getAllEvents = async ({ region } = {}) => {
  const query = knex('events')
    .leftJoin('artists as venue_profile', 'events.venue_profile_id', 'venue_profile.id')
    .leftJoin('artists as claimed_artist', 'events.artist_profile_id', 'claimed_artist.id')
    .leftJoin('users as claimed_user', 'events.claimed_by_user_id', 'claimed_user.id')
    .select(
      'events.*',
      'venue_profile.profile_image as venue_profile_image',
      'venue_profile.display_name as venue_profile_display_name',
      'venue_profile.slug as venue_profile_slug',
      'venue_profile.user_id as venue_profile_user_id',
      'venue_profile.website as venue_profile_website',
      'venue_profile.venue_address as venue_profile_address',
      'venue_profile.venue_city as venue_profile_city',
      'venue_profile.venue_state as venue_profile_state',
      'venue_profile.venue_postal_code as venue_profile_postal_code',
      'claimed_artist.display_name as claimed_artist_display_name',
      'claimed_artist.slug as claimed_artist_slug',
      'claimed_artist.profile_type as claimed_artist_profile_type',
      'claimed_artist.user_id as claimed_artist_user_id',
      'claimed_artist.website as claimed_artist_website',
      'claimed_user.email as claimed_by_user_email'
    );
  if (region && region !== REGION_ALL && REGION_SLUGS.has(String(region))) {
    query.where({ 'events.region': region });
  }
  const events = await query;
  const eventsWithVenueFallbacks = await applyDynamicVenueImageFallback(events);
  return attachEventImageFieldsToMany(eventsWithVenueFallbacks.map((event) => ({
    ...event,
    claimed_artist: event.artist_profile_id ? {
      id: event.artist_profile_id,
      display_name: event.claimed_artist_display_name,
      slug: event.claimed_artist_slug,
      profile_type: event.claimed_artist_profile_type,
      user_id: event.claimed_artist_user_id,
      website: event.claimed_artist_website,
    } : null,
    claimed_by_user_email: event.claimed_by_user_email,
  })));
};

const updateEvent = async(eventId, eventData) => {
  return knex('events')
    .where({ id: eventId })
    .update(eventData)
    .returning('*');
}

const findEventById = async (eventId) => {
  const event = await knex('events')
    .leftJoin('users', 'events.user_id', 'users.id')
    .leftJoin('artists as venue_profile', 'events.venue_profile_id', 'venue_profile.id')
    .leftJoin('artists as claimed_artist', 'events.artist_profile_id', 'claimed_artist.id')
    .leftJoin('users as claimed_user', 'events.claimed_by_user_id', 'claimed_user.id')
    .select(
      'events.*',
      'venue_profile.profile_image as venue_profile_image',
      'venue_profile.display_name as venue_profile_display_name',
      'venue_profile.slug as venue_profile_slug',
      'venue_profile.user_id as venue_profile_user_id',
      'venue_profile.website as venue_profile_website',
      'venue_profile.venue_address as venue_profile_address',
      'venue_profile.venue_city as venue_profile_city',
      'venue_profile.venue_state as venue_profile_state',
      'venue_profile.venue_postal_code as venue_profile_postal_code',
      'users.first_name as user_first_name',
      'users.last_name as user_last_name',
      'users.email as user_email',
      'claimed_artist.display_name as claimed_artist_display_name',
      'claimed_artist.slug as claimed_artist_slug',
      'claimed_artist.profile_type as claimed_artist_profile_type',
      'claimed_artist.user_id as claimed_artist_user_id',
      'claimed_artist.website as claimed_artist_website',
      'claimed_user.email as claimed_by_user_email'
    )
    .where('events.id', eventId)
    .first();

  if (!event) return null;

  const [eventWithVenueFallback] = await applyDynamicVenueImageFallback([event]);

  // Nest user data
  return attachEventImageFields({
    ...eventWithVenueFallback,
    user: {
      first_name: event.user_first_name,
      last_name: event.user_last_name,
      email: event.user_email,
    },
    claimed_artist: event.artist_profile_id ? {
      id: event.artist_profile_id,
      display_name: event.claimed_artist_display_name,
      slug: event.claimed_artist_slug,
      profile_type: event.claimed_artist_profile_type,
      user_id: event.claimed_artist_user_id,
      website: event.claimed_artist_website,
    } : null,
    claimed_by_user_email: event.claimed_by_user_email,
  });
};
const findBySlug = async (slug) => {
  const event = await knex('events')
    .leftJoin('artists as venue_profile', 'events.venue_profile_id', 'venue_profile.id')
    .leftJoin('artists as claimed_artist', 'events.artist_profile_id', 'claimed_artist.id')
    .leftJoin('users as claimed_user', 'events.claimed_by_user_id', 'claimed_user.id')
    .select(
      'events.*',
      'venue_profile.profile_image as venue_profile_image',
      'venue_profile.display_name as venue_profile_display_name',
      'venue_profile.slug as venue_profile_slug',
      'venue_profile.user_id as venue_profile_user_id',
      'venue_profile.website as venue_profile_website',
      'venue_profile.venue_address as venue_profile_address',
      'venue_profile.venue_city as venue_profile_city',
      'venue_profile.venue_state as venue_profile_state',
      'venue_profile.venue_postal_code as venue_profile_postal_code',
      'claimed_artist.display_name as claimed_artist_display_name',
      'claimed_artist.slug as claimed_artist_slug',
      'claimed_artist.profile_type as claimed_artist_profile_type',
      'claimed_artist.user_id as claimed_artist_user_id',
      'claimed_artist.website as claimed_artist_website',
      'claimed_user.email as claimed_by_user_email'
    )
    .where({ 'events.slug': slug, 'events.is_approved': true })
    .first();

  if (!event) return null;

  const [eventWithVenueFallback] = await applyDynamicVenueImageFallback([event]);

  return attachEventImageFields({
    ...eventWithVenueFallback,
    claimed_artist: event.artist_profile_id ? {
      id: event.artist_profile_id,
      display_name: event.claimed_artist_display_name,
      slug: event.claimed_artist_slug,
      profile_type: event.claimed_artist_profile_type,
      user_id: event.claimed_artist_user_id,
      website: event.claimed_artist_website,
    } : null,
    claimed_by_user_email: event.claimed_by_user_email,
  });
}



const deleteEvent = async (eventId) => {
  return knex('events')
    .where({ id: eventId })
    .del(); // This will delete the event
};

module.exports = {
  updateEvent,
  createEvent,
  createRecurringEvents,
  getEventsForReview,
  updateEventStatus,
  getAllEvents,
  findEventById,
  deleteEvent,
  findBySlug
}
