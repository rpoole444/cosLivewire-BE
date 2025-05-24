const slugify = require('../utils/slugify');
const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config);

async function generateUniqueSlug(title) {
  const baseSlug = slugify(title);
  let slug = baseSlug;

  const existingSlugs = await knex('events')
    .select('slug')
    .where('slug', 'like', `${baseSlug}%`);

  if (existingSlugs.length) {
    const suffixes = existingSlugs
      .map(e => e.slug)
      .filter(s => s.startsWith(baseSlug))
      .map(s => {
        const match = s.match(new RegExp(`^${baseSlug}-(\\d+)$`));
        return match ? parseInt(match[1]) : 0;
      });

    const maxSuffix = Math.max(0, ...suffixes);
    slug = `${baseSlug}-${maxSuffix + 1}`;
  }

  return slug;
}

module.exports = generateUniqueSlug;
