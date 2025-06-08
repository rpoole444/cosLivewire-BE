exports.up = function(knex) {
  return knex.schema.alterTable('artists', table => {
    table.timestamp('deleted_at').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('artists', table => {
    table.dropColumn('deleted_at');
  });
};
