const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config);
const isInTrial = require('../utils/isInTrial');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

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
    const events = await knex('events')
      .where({ is_approved: true })
      .andWhere(function() {
        this.where({ user_id: artist.user_id });
        if (artist.profile_type === 'venue') {
          this.orWhere({ venue_profile_id: artist.id });
          this.orWhereRaw('LOWER(TRIM(venue_name)) = LOWER(TRIM(?))', [artist.display_name]);
        }
      })
      .andWhere('date', '>=', today)
      .orderBy('date');

      const isTrialExpired =
        artist.trial_ends_at !== null ? !isInTrial(artist.trial_ends_at) : false;
    

    return {
      ...artist,
      events,
      trial_expired: isTrialExpired,
    };
  },

  findPublicScheduleBySlug: async (slug, limit = 5) => {
    const artist = await knex('artists')
      .select('id', 'user_id', 'display_name', 'slug', 'profile_type', 'home_region')
      .where({ slug, is_approved: true })
      .whereNull('deleted_at')
      .first();

    if (!artist) return null;

    const today = dayjs().tz('America/Denver').format('YYYY-MM-DD');
    const upcomingEvents = await knex('events')
      .select(
        'id',
        'title',
        'date',
        'start_time',
        'venue_name',
        'venue_profile_id',
        'location',
        'slug'
      )
      .where({ is_approved: true })
      .andWhere(function() {
        this.where({ user_id: artist.user_id });
        if (artist.profile_type === 'venue') {
          this.orWhere({ venue_profile_id: artist.id });
          this.orWhereRaw('LOWER(TRIM(venue_name)) = LOWER(TRIM(?))', [artist.display_name]);
        }
      })
      .andWhere('date', '>=', today)
      .orderBy('date')
      .orderBy('start_time')
      .limit(limit);

    return {
      id: artist.id,
      display_name: artist.display_name,
      slug: artist.slug,
      profile_type: artist.profile_type || 'artist',
      home_region: artist.home_region,
      events: upcomingEvents,
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
