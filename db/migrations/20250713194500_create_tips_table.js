exports.up = function (knex) {
  return knex.schema.createTable('tips', function (table) {
    table.increments('id').primary();
    table
      .integer('tipper_user_id')
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');
    table
      .integer('artist_id')
      .notNullable()
      .references('id')
      .inTable('artists')
      .onDelete('CASCADE');
    table.integer('amount_cents').notNullable();
    table.text('stripe_session_id');
    table.text('stripe_payment_intent_id');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('tips');
};
