const { findVenueProfileIdByInput } = require('../../utils/venueProfiles');

exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('events', 'venue_profile_id');
  if (!hasColumn) {
    await knex.schema.alterTable('events', (table) => {
      table
        .integer('venue_profile_id')
        .unsigned()
        .references('id')
        .inTable('artists')
        .onDelete('SET NULL')
        .index();
    });
  }

  const events = await knex('events')
    .select('id', 'venue_name', 'venue_profile_id')
    .whereNull('venue_profile_id')
    .whereNotNull('venue_name');

  for (const event of events) {
    const venueProfileId = await findVenueProfileIdByInput(knex, {
      venueName: event.venue_name,
    });

    if (venueProfileId) {
      await knex('events')
        .where({ id: event.id })
        .update({ venue_profile_id: venueProfileId });
    }
  }
};

exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('events', 'venue_profile_id');
  if (hasColumn) {
    await knex.schema.alterTable('events', (table) => {
      table.dropColumn('venue_profile_id');
    });
  }
};
