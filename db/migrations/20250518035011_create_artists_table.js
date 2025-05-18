exports.up = function(knex) {
  return knex.schema.createTable('artists', function(table) {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
    table.string('display_name').notNullable();
    table.text('bio');
    table.string('contact_email');
    table.string('profile_image');
    table.specificType('genres', 'TEXT[]'); // or use JSONB if preferred
    table.string('slug').notNullable().unique();
    table.timestamps(true, true); // created_at and updated_at
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('artists');
};
