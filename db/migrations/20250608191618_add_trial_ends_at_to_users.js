exports.up = function(knex) {
  return knex.schema.table('users', function(table) {
    table.timestamp('trial_ends_at');
  });
};

exports.down = function(knex) {
  return knex.schema.table('users', function(table) {
    table.dropColumn('trial_ends_at');
  });
};
