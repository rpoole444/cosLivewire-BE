exports.up = function(knex) {
  return knex.schema.table('artists', function(table) {
    table.boolean('is_approved').defaultTo(false);
  });
};

exports.down = function(knex) {
  return knex.schema.table('artists', function(table) {
    table.dropColumn('is_approved');
  });
};
