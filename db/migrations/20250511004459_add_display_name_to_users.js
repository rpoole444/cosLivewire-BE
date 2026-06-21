exports.up = async function(knex) {
  const exists = await knex.schema.hasColumn('users', 'display_name');
  if (!exists) {
    await knex.schema.alterTable('users', (table) => {
      table.string('display_name').nullable();
    });
  }
};

exports.down = async function(knex) {
  const exists = await knex.schema.hasColumn('users', 'display_name');
  if (exists) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('display_name');
    });
  }
};
