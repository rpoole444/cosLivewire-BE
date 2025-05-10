exports.up = function(knex) {
  return knex.schema.table('events', function(table) {
    table.string('recurring_group_id').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.table('events', function(table) {
    table.dropColumn('recurring_group_id');
  });
};
