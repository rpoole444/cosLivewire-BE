exports.up = function(knex) {
  return knex.schema.createTable('events', table => {
    table.increments('id').primary();
    table.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.string('title').notNullable();
    table.text('description').notNullable();
    table.string('location').notNullable();
    table.date('date').notNullable();
    table.string('genre').nullable();
    table.decimal('ticket_price').nullable();
    table.string('age_restriction').nullable();
    table.string('website_link').nullable();
    table.boolean('is_approved').defaultTo(false);
    table.timestamps(true, true);
  })
};

exports.down = function(knex) {
  return knex.schema.dropTable('events');
};
