exports.up = function (knex) {
  return knex.schema.createTable('invites', (table) => {
    table.increments('id').primary();
    table.string('code').notNullable().unique();
    table.integer('trial_days').notNullable().defaultTo(30);
    table.integer('max_uses').nullable();
    table.integer('used_count').notNullable().defaultTo(0);
    table.string('email').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.timestamp('used_at').nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('invites');
};
