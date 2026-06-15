exports.up = async function(knex) {
  await knex.schema.alterTable('artists', function(table) {
    table.string('profile_type', 32).notNullable().defaultTo('artist').index();
    table.string('venue_address');
    table.string('venue_city');
    table.string('venue_state', 64);
    table.string('venue_postal_code', 20);
    table.string('venue_phone', 40);
    table.string('booking_email');
    table.integer('venue_capacity').unsigned();
    table.string('age_policy', 80);
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('artists', function(table) {
    table.dropIndex(['profile_type']);
    table.dropColumns(
      'profile_type',
      'venue_address',
      'venue_city',
      'venue_state',
      'venue_postal_code',
      'venue_phone',
      'booking_email',
      'venue_capacity',
      'age_policy'
    );
  });
};
