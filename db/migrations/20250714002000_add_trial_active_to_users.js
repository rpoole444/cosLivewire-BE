exports.up = async function (knex) {
  const exists = await knex.schema.hasColumn('users', 'trial_active');
  if (!exists) {
    await knex.schema.alterTable('users', (table) => {
      table.boolean('trial_active').notNullable().defaultTo(true);
    });
  }
};

exports.down = async function (knex) {
  const exists = await knex.schema.hasColumn('users', 'trial_active');
  if (exists) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('trial_active');
    });
  }
};
