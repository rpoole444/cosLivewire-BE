const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config);
const isInTrial = require('../utils/isInTrial');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { attachEventImageFieldsToMany } = require('../utils/eventImages');

dayjs.extend(utc);
dayjs.extend(timezone);

const selectPublicEventFields = [
  'events.id',
  'events.title',
  'events.date',
  'events.start_time',
  'events.venue_name',
  'events.venue_profile_id',
  'events.location',
  'events.poster',
  'events.website_link',
  'events.ticket_price',
  'events.slug',
  'events.source',
  'events.source_label',
  'venue_profile.profile_image as venue_profile_image',
  'venue_profile.display_name as venue_profile_display_name',
  'venue_profile.venue_address as venue_profile_address',
  'venue_profile.venue_city as venue_profile_city',
  'venue_profile.venue_state as venue_profile_state',
  'venue_profile.venue_postal_code as venue_profile_postal_code',
];

const venueSqlNormalize = (columnOrPlaceholder) => (
  `TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(${columnOrPlaceholder}), '&', ' and ', 'g'), '[^a-z0-9]+', ' ', 'g'), '\\s+', ' ', 'g'))`
);

const applyProfileEventMatch = (builder, artist) => {
  if (artist.profile_type === 'venue') {
    const eventVenueName = venueSqlNormalize('events.venue_name');
    const profileVenueName = venueSqlNormalize('?');

    builder
      .where({ 'events.venue_profile_id': artist.id })
      .orWhereRaw('LOWER(TRIM(venue_name)) = LOWER(TRIM(?))', [artist.display_name])
      .orWhereRaw(
        `${eventVenueName} <> '' AND ${profileVenueName} <> '' AND (` +
          `${eventVenueName} LIKE CONCAT('%', ${profileVenueName}, '%') OR ` +
          `${profileVenueName} LIKE CONCAT('%', ${eventVenueName}, '%')` +
        ')',
        [artist.display_name, artist.display_name, artist.display_name]
      );
    return;
  }

  builder
    .where({ 'events.artist_profile_id': artist.id })
    .orWhere({ 'events.user_id': artist.user_id });
};

const Artist = {
  findBySlug: async (slug) => {
    return knex('artists')
      .where({ slug })
      .andWhere('deleted_at', null)
      .first();
  },

  // Check if a slug exists regardless of soft deletion
  slugExists: async (slug) => {
    const existing = await knex('artists')
      .where({ slug })
      .first();
    return !!existing;
  },

  findAllPublic: async ({ includeUnlisted = false } = {}) => {
    const query = knex('artists as a')
      .select(
        'a.id',
        'a.display_name',
        'a.slug',
        'a.profile_image',
        'a.genres',
        'a.bio',
        'a.profile_type',
        'a.is_shell',
        'a.home_region',
        'a.venue_city',
        'a.venue_state',
        'a.is_pro as artist_is_pro',
        'a.trial_active',
        'a.updated_at',
        'a.user_id',
        'u.is_pro as user_is_pro',
        'u.trial_ends_at as user_trial_ends_at',
        'u.pro_cancelled_at as user_pro_cancelled_at',
        'u.stripe_customer_id as user_stripe_customer_id'
      )
      .leftJoin('users as u', 'a.user_id', 'u.id')
      .whereNull('a.deleted_at')
      .andWhere({ 'a.is_approved': true })
      .orderBy('a.display_name');

    if (!includeUnlisted) {
      query.andWhere({ 'a.is_listed': true });
    }

    return query;
  },

  findBySlugWithEvents: async (slug) => {
    const artist = await knex('artists as a')
      .select(
        'a.*',
        'u.trial_ends_at',
        'u.is_pro',
        'u.pro_cancelled_at',
        'u.stripe_customer_id'
      )
      .leftJoin('users as u', 'a.user_id', 'u.id')
      .where('a.slug', slug)
      .andWhere('a.deleted_at', null)
      .first();

    if (!artist) return null;

    const today = dayjs().tz('America/Denver').format('YYYY-MM-DD');
    const eventsQuery = knex('events')
      .leftJoin('artists as venue_profile', 'events.venue_profile_id', 'venue_profile.id')
      .select(
        'events.*',
        'venue_profile.profile_image as venue_profile_image',
        'venue_profile.display_name as venue_profile_display_name',
        'venue_profile.venue_address as venue_profile_address',
        'venue_profile.venue_city as venue_profile_city',
        'venue_profile.venue_state as venue_profile_state',
        'venue_profile.venue_postal_code as venue_profile_postal_code'
      )
      .where({ 'events.is_approved': true })
      .andWhere(function() {
        applyProfileEventMatch(this, artist);
      })
      .andWhere('events.date', '>=', today)
      .orderBy('events.date')
      .orderBy('events.start_time');

    if (artist.profile_type === 'venue' && artist.is_shell) {
      eventsQuery.limit(5);
    }

    const events = await eventsQuery;

    const pastEvents = artist.profile_type === 'venue'
      ? await knex('events')
          .leftJoin('artists as venue_profile', 'events.venue_profile_id', 'venue_profile.id')
          .select(
            'events.id',
            'events.title',
            'events.date',
            'events.start_time',
            'events.venue_name',
            'events.location',
            'events.genre',
            'events.poster',
            'events.slug',
            'events.source',
            'events.source_label',
            'venue_profile.profile_image as venue_profile_image',
            'venue_profile.display_name as venue_profile_display_name',
            'venue_profile.venue_address as venue_profile_address',
            'venue_profile.venue_city as venue_profile_city',
            'venue_profile.venue_state as venue_profile_state',
            'venue_profile.venue_postal_code as venue_profile_postal_code'
          )
          .where({ 'events.is_approved': true })
          .andWhere(function() {
            applyProfileEventMatch(this, artist);
          })
          .andWhere('events.date', '<', today)
          .orderBy('events.date', 'desc')
          .orderBy('events.start_time', 'desc')
          .limit(12)
      : [];

      const isTrialExpired =
        artist.trial_ends_at !== null ? !isInTrial(artist.trial_ends_at) : false;
    

    return {
      ...artist,
      events: attachEventImageFieldsToMany(events),
      past_events: attachEventImageFieldsToMany(pastEvents),
      trial_expired: isTrialExpired,
    };
  },

  findPublicScheduleBySlug: async (slug, limit = 5, options = {}) => {
    const artist = await knex('artists')
      .select('id', 'user_id', 'display_name', 'slug', 'profile_type', 'home_region')
      .where({ slug, is_approved: true })
      .whereNull('deleted_at')
      .first();

    if (!artist) return null;

    const today = dayjs().tz('America/Denver').format('YYYY-MM-DD');
    const mode = options.mode === 'top-picks' ? 'top-picks' : 'upcoming';
    const query = knex('events')
      .leftJoin('artists as venue_profile', 'events.venue_profile_id', 'venue_profile.id')
      .select(selectPublicEventFields)
      .where({ 'events.is_approved': true })
      .andWhere('events.date', '>=', today);

    if (mode === 'top-picks') {
      query
        .join('profile_featured_events as pfe', 'pfe.event_id', 'events.id')
        .andWhere('pfe.profile_id', artist.id)
        .orderBy('pfe.featured_order')
        .orderBy('events.date')
        .orderBy('events.start_time');
    } else {
      query
        .andWhere(function() {
          applyProfileEventMatch(this, artist);
        })
        .orderBy('events.date')
        .orderBy('events.start_time');
    }

    const upcomingEvents = await query.limit(limit);

    return {
      id: artist.id,
      display_name: artist.display_name,
      slug: artist.slug,
      profile_type: artist.profile_type || 'artist',
      home_region: artist.home_region,
      mode,
      events: attachEventImageFieldsToMany(upcomingEvents),
    };
  },

  findTopPicksManageListBySlug: async (slug) => {
    const artist = await knex('artists')
      .select('id', 'user_id', 'display_name', 'slug', 'profile_type')
      .where({ slug })
      .whereNull('deleted_at')
      .first();

    if (!artist) return null;

    const today = dayjs().tz('America/Denver').format('YYYY-MM-DD');
    const events = await knex('events')
      .leftJoin('artists as venue_profile', 'events.venue_profile_id', 'venue_profile.id')
      .leftJoin('profile_featured_events as pfe', function() {
        this.on('pfe.event_id', '=', 'events.id')
          .andOn('pfe.profile_id', '=', knex.raw('?', [artist.id]));
      })
      .select(
        ...selectPublicEventFields,
        'pfe.featured_order',
        knex.raw('pfe.id IS NOT NULL as is_top_pick')
      )
      .where({ 'events.is_approved': true })
      .andWhere(function() {
        applyProfileEventMatch(this, artist);
      })
      .andWhere('events.date', '>=', today)
      .orderBy('events.date')
      .orderBy('events.start_time');

    return {
      profile: artist,
      events: attachEventImageFieldsToMany(events),
    };
  },

  findByUserId: async (user_id) => {
    return knex('artists')
      .where({ user_id })
      .whereNull('deleted_at')
      .first();
  },
  
  create: async (artistData) => {
    const [newArtist] = await knex('artists')
      .insert({
        is_approved: false,
        is_listed: false, 
        ...artistData
      })
      .returning('*');
    return newArtist;
  },

  update: async (slug, updates) => {
    const [updated] = await knex('artists')
      .where({ slug })
      .andWhere('deleted_at', null)
      .update(updates)
      .returning('*');
    return updated;
  },

  restore: async (id) => {
    const [restored] = await knex('artists')
      .where({ id })
      .update({ deleted_at: null })
      .returning('*');
    return restored;
  }
};

module.exports = Artist;
