exports.up = function(knex) {
  return knex.schema.table('users', function(table) {
    table.string('display_name').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.table('users', function(table) {
    table.dropColumn('display_name');
  });
};
