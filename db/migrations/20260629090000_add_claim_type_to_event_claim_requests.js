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
  await addColumnIfMissing(knex, 'event_claim_requests', 'claim_type', (table) => {
    table.string('claim_type', 24).notNullable().defaultTo('artist').index();
  });
};

exports.down = async function(knex) {
  await dropColumnIfExists(knex, 'event_claim_requests', 'claim_type');
};
