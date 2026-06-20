exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('event_claim_requests');
  if (exists) return;

  await knex.schema.createTable('event_claim_requests', (table) => {
    table.increments('id').primary();
    table
      .integer('event_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('events')
      .onDelete('CASCADE')
      .index();
    table
      .integer('artist_profile_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('artists')
      .onDelete('CASCADE')
      .index();
    table
      .integer('requested_by_user_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE')
      .index();
    table
      .integer('reviewed_by_user_id')
      .unsigned()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL')
      .index();
    table.string('status', 24).notNullable().defaultTo('pending').index();
    table.timestamp('reviewed_at');
    table.text('admin_notes');
    table.timestamps(true, true);
    table.unique(['event_id', 'artist_profile_id']);
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('event_claim_requests');
};
