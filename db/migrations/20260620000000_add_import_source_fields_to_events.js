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
  await addColumnIfMissing(knex, 'events', 'source', (table) => {
    table.string('source', 64).index();
  });

  await addColumnIfMissing(knex, 'events', 'source_label', (table) => {
    table.string('source_label', 160);
  });

  await addColumnIfMissing(knex, 'events', 'source_fingerprint', (table) => {
    table.string('source_fingerprint', 128).index();
  });

  await addColumnIfMissing(knex, 'events', 'source_import_event_id', (table) => {
    table
      .integer('source_import_event_id')
      .unsigned()
      .references('id')
      .inTable('import_events')
      .onDelete('SET NULL')
      .index();
  });

  await addColumnIfMissing(knex, 'events', 'artist_profile_id', (table) => {
    table
      .integer('artist_profile_id')
      .unsigned()
      .references('id')
      .inTable('artists')
      .onDelete('SET NULL')
      .index();
  });

  await knex.schema.raw(
    'CREATE UNIQUE INDEX IF NOT EXISTS events_source_fingerprint_unique ON events(source, source_fingerprint)'
  );
};

exports.down = async function(knex) {
  await knex.schema.raw('DROP INDEX IF EXISTS events_source_fingerprint_unique');

  await dropColumnIfExists(knex, 'events', 'artist_profile_id');
  await dropColumnIfExists(knex, 'events', 'source_import_event_id');
  await dropColumnIfExists(knex, 'events', 'source_fingerprint');
  await dropColumnIfExists(knex, 'events', 'source_label');
  await dropColumnIfExists(knex, 'events', 'source');
};
