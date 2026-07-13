const addColumnIfMissing = async (knex, tableName, columnName, addColumn) => {
  const exists = await knex.schema.hasColumn(tableName, columnName);
  if (!exists) {
    await knex.schema.alterTable(tableName, addColumn);
  }
};

const dropColumnIfExists = async (knex, tableName, columnName) => {
  const exists = await knex.schema.hasColumn(tableName, columnName);
  if (exists) {
    await knex.schema.alterTable(tableName, (table) => {
      table.dropColumn(columnName);
    });
  }
};

exports.up = async function(knex) {
  const hasVenueAliases = await knex.schema.hasTable('venue_aliases');
  if (!hasVenueAliases) {
    await knex.schema.createTable('venue_aliases', (table) => {
      table.increments('id').primary();
      table
        .integer('venue_profile_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('artists')
        .onDelete('CASCADE')
        .index();
      table.string('alias', 255).notNullable();
      table.string('normalized_alias', 255).notNullable();
      table.string('source', 80).notNullable().defaultTo('admin');
      table.decimal('confidence', 5, 4).notNullable().defaultTo(1);
      table.boolean('is_verified').notNullable().defaultTo(false).index();
      table
        .integer('created_by')
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
        .index();
      table.timestamps(true, true);
      table.unique(['normalized_alias', 'venue_profile_id']);
      table.index('normalized_alias');
    });
  }

  const hasEventArtists = await knex.schema.hasTable('event_artists');
  if (!hasEventArtists) {
    await knex.schema.createTable('event_artists', (table) => {
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
        .references('id')
        .inTable('artists')
        .onDelete('SET NULL')
        .index();
      table.string('raw_artist_name', 255);
      table.integer('billing_order').notNullable().defaultTo(0);
      table.string('role', 80).notNullable().defaultTo('performer');
      table.string('match_status', 40).notNullable().defaultTo('unmatched').index();
      table.string('match_confidence', 40).notNullable().defaultTo('low');
      table.boolean('is_headliner').notNullable().defaultTo(false);
      table.timestamps(true, true);
      table.unique(['event_id', 'artist_profile_id']);
      table.index(['event_id', 'billing_order']);
    });
  }

  const hasDuplicateDecisions = await knex.schema.hasTable('duplicate_event_decisions');
  if (!hasDuplicateDecisions) {
    await knex.schema.createTable('duplicate_event_decisions', (table) => {
      table.increments('id').primary();
      table.integer('left_event_id').unsigned().references('id').inTable('events').onDelete('CASCADE').index();
      table.integer('right_event_id').unsigned().references('id').inTable('events').onDelete('CASCADE').index();
      table.integer('import_event_id').unsigned().references('id').inTable('import_events').onDelete('CASCADE').index();
      table.string('decision', 40).notNullable().index();
      table.text('notes');
      table.integer('decided_by').unsigned().references('id').inTable('users').onDelete('SET NULL').index();
      table.timestamps(true, true);
      table.unique(['left_event_id', 'right_event_id', 'import_event_id']);
    });
  }

  const hasAuditLogs = await knex.schema.hasTable('data_quality_audit_logs');
  if (!hasAuditLogs) {
    await knex.schema.createTable('data_quality_audit_logs', (table) => {
      table.increments('id').primary();
      table.integer('actor_user_id').unsigned().references('id').inTable('users').onDelete('SET NULL').index();
      table.string('action', 120).notNullable().index();
      table.string('entity_type', 60).notNullable().index();
      table.integer('entity_id').index();
      table.jsonb('previous_value');
      table.jsonb('new_value');
      table.jsonb('metadata');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now()).index();
    });
  }

  await addColumnIfMissing(knex, 'events', 'raw_venue_name', (table) => {
    table.string('raw_venue_name', 255);
  });
  await addColumnIfMissing(knex, 'events', 'venue_match_status', (table) => {
    table.string('venue_match_status', 40).notNullable().defaultTo('unmatched').index();
  });
  await addColumnIfMissing(knex, 'events', 'venue_match_confidence', (table) => {
    table.string('venue_match_confidence', 40);
  });
  await addColumnIfMissing(knex, 'events', 'venue_match_source', (table) => {
    table.string('venue_match_source', 80);
  });
  await addColumnIfMissing(knex, 'events', 'venue_matched_at', (table) => {
    table.timestamp('venue_matched_at');
  });
  await addColumnIfMissing(knex, 'events', 'venue_matched_by', (table) => {
    table.integer('venue_matched_by').unsigned().references('id').inTable('users').onDelete('SET NULL').index();
  });
  await addColumnIfMissing(knex, 'events', 'data_quality_reviewed_at', (table) => {
    table.timestamp('data_quality_reviewed_at').index();
  });
  await addColumnIfMissing(knex, 'events', 'data_quality_reviewed_by', (table) => {
    table.integer('data_quality_reviewed_by').unsigned().references('id').inTable('users').onDelete('SET NULL').index();
  });

  await knex('events')
    .whereNull('raw_venue_name')
    .whereNotNull('venue_name')
    .update({ raw_venue_name: knex.raw('venue_name') });
  await knex('events')
    .whereNotNull('venue_profile_id')
    .update({ venue_match_status: 'matched', venue_match_confidence: 'exact', venue_match_source: 'existing_profile_id' });
};

exports.down = async function(knex) {
  await dropColumnIfExists(knex, 'events', 'data_quality_reviewed_by');
  await dropColumnIfExists(knex, 'events', 'data_quality_reviewed_at');
  await dropColumnIfExists(knex, 'events', 'venue_matched_by');
  await dropColumnIfExists(knex, 'events', 'venue_matched_at');
  await dropColumnIfExists(knex, 'events', 'venue_match_source');
  await dropColumnIfExists(knex, 'events', 'venue_match_confidence');
  await dropColumnIfExists(knex, 'events', 'venue_match_status');
  await dropColumnIfExists(knex, 'events', 'raw_venue_name');

  await knex.schema.dropTableIfExists('data_quality_audit_logs');
  await knex.schema.dropTableIfExists('duplicate_event_decisions');
  await knex.schema.dropTableIfExists('event_artists');
  await knex.schema.dropTableIfExists('venue_aliases');
};
