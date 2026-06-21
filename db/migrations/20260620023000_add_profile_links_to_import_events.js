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
  await addColumnIfMissing(knex, 'import_events', 'artist_profile_id', (table) => {
    table
      .integer('artist_profile_id')
      .unsigned()
      .references('id')
      .inTable('artists')
      .onDelete('SET NULL')
      .index();
  });

  await addColumnIfMissing(knex, 'import_events', 'venue_profile_id', (table) => {
    table
      .integer('venue_profile_id')
      .unsigned()
      .references('id')
      .inTable('artists')
      .onDelete('SET NULL')
      .index();
  });
};

exports.down = async function(knex) {
  await dropColumnIfExists(knex, 'import_events', 'venue_profile_id');
  await dropColumnIfExists(knex, 'import_events', 'artist_profile_id');
};
