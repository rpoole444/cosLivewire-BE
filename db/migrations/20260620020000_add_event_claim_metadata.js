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
  await addColumnIfMissing(knex, 'events', 'claimed_by_user_id', (table) => {
    table
      .integer('claimed_by_user_id')
      .unsigned()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL')
      .index();
  });

  await addColumnIfMissing(knex, 'events', 'claimed_at', (table) => {
    table.timestamp('claimed_at');
  });

  await addColumnIfMissing(knex, 'events', 'last_edited_by_user_id', (table) => {
    table
      .integer('last_edited_by_user_id')
      .unsigned()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL')
      .index();
  });
};

exports.down = async function(knex) {
  await dropColumnIfExists(knex, 'events', 'last_edited_by_user_id');
  await dropColumnIfExists(knex, 'events', 'claimed_at');
  await dropColumnIfExists(knex, 'events', 'claimed_by_user_id');
};
