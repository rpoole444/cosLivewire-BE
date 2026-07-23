exports.up = async function addEventFeedIndexes(knex) {
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS events_public_date_idx
    ON events (date, start_time)
    WHERE is_approved = true
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS events_public_region_date_idx
    ON events (region, date, start_time)
    WHERE is_approved = true
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS events_venue_schedule_idx
    ON events (venue_profile_id, date, start_time)
    WHERE is_approved = true AND venue_profile_id IS NOT NULL
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS events_artist_schedule_idx
    ON events (artist_profile_id, date, start_time)
    WHERE is_approved = true AND artist_profile_id IS NOT NULL
  `);
};

exports.down = async function removeEventFeedIndexes(knex) {
  await knex.raw('DROP INDEX IF EXISTS events_artist_schedule_idx');
  await knex.raw('DROP INDEX IF EXISTS events_venue_schedule_idx');
  await knex.raw('DROP INDEX IF EXISTS events_public_region_date_idx');
  await knex.raw('DROP INDEX IF EXISTS events_public_date_idx');
};
