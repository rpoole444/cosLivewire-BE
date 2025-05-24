const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config);
const generateUniqueSlug = require('../utils/generateUniqueSlug');

async function backfillSlugs() {
  try {
    const eventsWithoutSlug = await knex('events')
      .whereNull('slug')
      .orWhere('slug', '');

    console.log(`Found ${eventsWithoutSlug.length} events without slugs.`);

    for (const event of eventsWithoutSlug) {
      const slug = await generateUniqueSlug(event.title);
      await knex('events')
        .where({ id: event.id })
        .update({ slug });
      console.log(`Updated event ID ${event.id} with slug: ${slug}`);
    }

    console.log('✅ Slug backfill complete.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error backfilling slugs:', error);
    process.exit(1);
  }
}

backfillSlugs();
