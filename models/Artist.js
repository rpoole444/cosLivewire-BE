const db = require('../db/knex');
const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config);

const Artist = {
  findBySlug: async (slug) => {
    return db('artists').where({ slug }).first();
  },

  findBySlugWithEvents: async (slug) => {
    const artist = await db('artists').where({ slug }).first();
    if (!artist) return null;

    const events = await db('events')
      .where({ user_id: artist.user_id })
      .andWhere('date', '>=', new Date())
      .orderBy('date');

    return { ...artist, events };
  },

  create: async (artistData) => {
    const [newArtist] = await db('artists')
      .insert(artistData)
      .returning('*');
    return newArtist;
  }
};

module.exports = Artist;
