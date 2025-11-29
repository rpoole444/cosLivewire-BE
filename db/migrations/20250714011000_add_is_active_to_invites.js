exports.up = async function (knex) {
  const hasDescription = await knex.schema.hasColumn('invites', 'description');
  if (!hasDescription) {
    await knex.schema.alterTable('invites', (table) => {
      table.text('description');
    });
  }

  const hasIsActive = await knex.schema.hasColumn('invites', 'is_active');
  if (!hasIsActive) {
    await knex.schema.alterTable('invites', (table) => {
      table.boolean('is_active').notNullable().defaultTo(true);
    });
  }
};

exports.down = async function (knex) {
  const hasDescription = await knex.schema.hasColumn('invites', 'description');
  if (hasDescription) {
    await knex.schema.alterTable('invites', (table) => {
      table.dropColumn('description');
    });
  }

  const hasIsActive = await knex.schema.hasColumn('invites', 'is_active');
  if (hasIsActive) {
    await knex.schema.alterTable('invites', (table) => {
      table.dropColumn('is_active');
    });
  }
};
