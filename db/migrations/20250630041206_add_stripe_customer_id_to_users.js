exports.up = function(knex) {
  return knex.schema.table('users', function(table) {
    table.string('stripe_customer_id');
  });
};
exports.down = function(knex) {
  return knex.schema.table('users', function(table) {
    table.dropColumn('stripe_customer_id');
  });
};
