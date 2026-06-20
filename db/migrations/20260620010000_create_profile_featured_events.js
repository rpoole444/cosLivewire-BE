exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('profile_featured_events');
  if (exists) return;

  await knex.schema.createTable('profile_featured_events', (table) => {
    table.increments('id').primary();
    table
      .integer('profile_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('artists')
      .onDelete('CASCADE')
      .index();
    table
      .integer('event_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('events')
      .onDelete('CASCADE')
      .index();
    table.integer('featured_order').unsigned().notNullable().defaultTo(0);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['profile_id', 'event_id'], {
      indexName: 'profile_featured_events_profile_event_unique',
    });
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('profile_featured_events');
};
