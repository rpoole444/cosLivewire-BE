const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config);
const isInTrial = require('../utils/isInTrial');

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

  findAllPublic: async () => {
    return knex('artists')
      .select('display_name', 'slug', 'profile_image', 'genres', 'bio')
      .whereNull('deleted_at')
      .andWhere({ is_approved: true, is_listed: true  })
      .orderBy('display_name');
  },

  findBySlugWithEvents: async (slug) => {
    const artist = await knex('artists as a')
      .select('a.*', 'u.trial_ends_at', 'u.is_pro')
      .leftJoin('users as u', 'a.user_id', 'u.id')
      .where('a.slug', slug)
      .andWhere('a.deleted_at', null)
      .first();

    if (!artist) return null;

    const events = await knex('events')
      .where({ user_id: artist.user_id })
      .andWhere('date', '>=', new Date())
      .orderBy('date');

      const isTrialExpired =
        artist.trial_ends_at !== null ? !isInTrial(artist.trial_ends_at) : false;
    

    return {
      ...artist,
      events,
      trial_expired: isTrialExpired,
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
