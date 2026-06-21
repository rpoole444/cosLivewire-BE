exports.up = async function(knex) {
  const exists = await knex.schema.hasColumn('artists', 'is_approved');
  if (!exists) {
    await knex.schema.alterTable('artists', (table) => {
      table.boolean('is_approved').defaultTo(false);
    });
  }
};

exports.down = async function(knex) {
  const exists = await knex.schema.hasColumn('artists', 'is_approved');
  if (exists) {
    await knex.schema.alterTable('artists', (table) => {
      table.dropColumn('is_approved');
    });
  }
};
