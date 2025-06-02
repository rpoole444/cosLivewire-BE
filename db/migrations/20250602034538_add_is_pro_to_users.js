// migrations/20250601_add_is_pro_to_users.js

exports.up = function (knex) {
  return knex.schema.alterTable('users', (table) => {
    table.boolean('is_pro').defaultTo(false);
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('users', (table) => {
    table.dropColumn('is_pro');
  });
};

