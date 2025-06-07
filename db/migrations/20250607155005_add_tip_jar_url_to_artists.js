exports.up = function(knex) {
  return knex.schema.table('artists', function(table) {
    table.text('tip_jar_url');
  });
};

exports.down = function(knex) {
  return knex.schema.table('artists', function(table) {
    table.dropColumn('tip_jar_url');
  });
};

