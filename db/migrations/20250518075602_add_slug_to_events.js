exports.up = function(knex) {
  return knex.schema.table('events', function(table) {
    table.string('slug').unique();
  });
};

exports.down = function(knex) {
  return knex.schema.table('events', function(table) {
    table.dropColumn('slug');
  });
};
