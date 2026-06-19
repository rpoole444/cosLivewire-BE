exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('artist_analytics_events');
  if (exists) return;

  await knex.schema.createTable('artist_analytics_events', (table) => {
    table.increments('id').primary();
    table
      .integer('artist_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('artists')
      .onDelete('CASCADE')
      .index();
    table.string('event_type', 64).notNullable().index();
    table.integer('event_id').unsigned().nullable().references('id').inTable('events').onDelete('SET NULL');
    table.string('source', 64).nullable();
    table.string('referrer', 512).nullable();
    table.string('user_agent', 512).nullable();
    table.string('ip_hash', 128).nullable();
    table.jsonb('metadata').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now()).index();
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('artist_analytics_events');
};
