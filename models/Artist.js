const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config)

const Artist = {
  findBySlug: async (slug) => {
    return knex('artists').where({ slug }).first();
  },

  findBySlugWithEvents: async (slug) => {
    const artist = await knex('artists').where({ slug }).first();
    if (!artist) return null;

    const events = await knex('events')
      .where({ user_id: artist.user_id })
      .andWhere('date', '>=', new Date())
      .orderBy('date');

    return { ...artist, events };
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
