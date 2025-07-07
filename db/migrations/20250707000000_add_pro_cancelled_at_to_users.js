exports.up = function(knex) {
  return knex.schema.alterTable('users', (table) => {
    table.timestamp('pro_cancelled_at').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('users', (table) => {
    table.dropColumn('pro_cancelled_at');
  });
};
