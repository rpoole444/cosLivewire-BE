exports.up = async function(knex) {
  const exists = await knex.schema.hasColumn('users', 'pro_cancelled_at');
  if (!exists) {
    await knex.schema.alterTable('users', (table) => {
      table.timestamp('pro_cancelled_at').nullable();
    });
  }
};

exports.down = async function(knex) {
  const exists = await knex.schema.hasColumn('users', 'pro_cancelled_at');
  if (exists) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('pro_cancelled_at');
    });
  }
};
