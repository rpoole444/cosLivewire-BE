exports.up = function(knex) {
  return knex.schema
    .createTable('import_batches', table => {
      table.increments('id').primary();
      table.string('source').notNullable();
      table.text('raw_text');
      table
        .integer('created_by_user_id')
        .references('id')
        .inTable('users')
        .onDelete('SET NULL');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    })
    .createTable('import_events', table => {
      table.increments('id').primary();
      table
        .integer('batch_id')
        .notNullable()
        .references('id')
        .inTable('import_batches')
        .onDelete('CASCADE');

      table.string('title');
      table.string('artist_display');
      table.timestamp('start_at').notNullable();
      table.timestamp('end_at');
      table.string('venue_name');
      table.string('venue_address');
      table.string('city');
      table.text('description');
      table.string('image_url');
      table.integer('promoter_id');
      table.string('source');
      table.string('fingerprint');

      table
        .enu('status', ['pending', 'accepted', 'rejected'])
        .notNullable()
        .defaultTo('pending');
      table.text('raw_block');
      table.jsonb('parse_warnings');
      table
        .integer('promoted_event_id')
        .references('id')
        .inTable('events')
        .onDelete('SET NULL');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

      table.index('batch_id');
      table.index('status');
      table.index('fingerprint');
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('import_events')
    .dropTableIfExists('import_batches');
};
