exports.up = function(knex) {
  return knex.schema.table('artists', function(table) {
    table.boolean('trial_active').defaultTo(true);
    table.timestamp('trial_start_date').defaultTo(knex.fn.now());
  });
};

exports.down = function(knex) {
  return knex.schema.table('artists', function(table) {
    table.dropColumn('trial_active');
    table.dropColumn('trial_start_date');
  });
};
