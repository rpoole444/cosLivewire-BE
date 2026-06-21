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
  await addColumnIfMissing(knex, 'artists', 'is_shell', (table) => {
    table.boolean('is_shell').notNullable().defaultTo(false).index();
  });

  await addColumnIfMissing(knex, 'artists', 'shell_created_by_user_id', (table) => {
    table
      .integer('shell_created_by_user_id')
      .unsigned()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL')
      .index();
  });

  await addColumnIfMissing(knex, 'artists', 'shell_claimed_at', (table) => {
    table.timestamp('shell_claimed_at');
  });

  await addColumnIfMissing(knex, 'import_batches', 'source_name', (table) => {
    table.string('source_name', 160);
  });

  await addColumnIfMissing(knex, 'import_batches', 'source_url', (table) => {
    table.string('source_url', 500);
  });
};

exports.down = async function(knex) {
  await dropColumnIfExists(knex, 'import_batches', 'source_url');
  await dropColumnIfExists(knex, 'import_batches', 'source_name');
  await dropColumnIfExists(knex, 'artists', 'shell_claimed_at');
  await dropColumnIfExists(knex, 'artists', 'shell_created_by_user_id');
  await dropColumnIfExists(knex, 'artists', 'is_shell');
};
