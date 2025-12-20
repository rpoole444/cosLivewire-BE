exports.up = function(knex) {
  return knex.schema.alterTable('import_events', table => {
    // Allow incomplete imports; required fields are enforced at promote time.
    table.timestamp('start_at').nullable().alter();

    // Canonical promotion fields aligned with events (kept minimal on purpose).
    table.date('date');
    table.time('start_time');
    table.time('end_time');
    table.string('location');
    table.string('address');
    table.string('city');
    table.string('title');
    table.string('artist_display');
    table.string('poster');
    table.string('website');
    table.string('genre');
    table.integer('user_id');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('import_events', table => {
    table.timestamp('start_at').notNullable().alter();

    table.dropColumn('date');
    table.dropColumn('start_time');
    table.dropColumn('end_time');
    table.dropColumn('location');
    table.dropColumn('address');
    table.dropColumn('city');
    table.dropColumn('title');
    table.dropColumn('artist_display');
    table.dropColumn('poster');
    table.dropColumn('website');
    table.dropColumn('genre');
    table.dropColumn('user_id');
  });
};
