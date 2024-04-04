exports.up = function(knex) {
  return knex.schema.createTable('users', table => {
    table.increments('id').primary();
    table.string('first_name').notNullable();
    table.string('last_name').notNullable();
    table.string('email').unique().notNullable();
    table.string('password').notNullable();
    table.boolean('is_admin').defaultTo(false);
    table.boolean('is_logged_in').defaultTo(false);
    table.string('reset_token'); 
    table.datetime('reset_token_expires');
    table.specificType('approved_events', 'integer[]').defaultTo('{}'); // Adjust type as needed
    table.string('user_description');
    table.text('top_music_genres','[]') 
    table.timestamps(true, true);
  })
};

exports.down = function(knex) {
  return knex.schema.dropTable('users');
};

