const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config)

const Artist = {
  findBySlug: async (slug) => {
    return knex('artists').where({ slug }).first();
  },
  findAllPublic: async () => {
    return await knex('artists')
      .select('display_name', 'slug', 'profile_image', 'genres', 'bio')
      .orderBy('display_name');
  },
  findBySlugWithEvents: async (slug) => {
    const artist = await knex('artists as a')
      .select('a.*', 'u.trial_ends_at', 'u.is_pro') // include trial + subscription info
      .leftJoin('users as u', 'a.user_id', 'u.id')
      .where('a.slug', slug)
      .first();
  
    if (!artist) return null;
  
    const events = await knex('events')
      .where({ user_id: artist.user_id })
      .andWhere('date', '>=', new Date())
      .orderBy('date');
  
    const isTrialExpired = artist.trial_ends_at
      ? new Date() > new Date(artist.trial_ends_at)
      : true;
  
    return {
      ...artist,
      events,
      trial_expired: isTrialExpired,
    };
  },

  findByUserId: async (user_id) => {
    return knex('artists').where({ user_id }).first();
  },
  create: async (artistData) => {
    const [newArtist] = await knex('artists')
      .insert(artistData)
      .returning('*');
    return newArtist;
  },
  update: async (slug, updates) => {
    const [updated] = await knex('artists')
      .where({ slug })
      .update(updates)
      .returning('*');
    return updated;
  }
};

module.exports = Artist;
