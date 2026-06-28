exports.up = async function(knex) {
  const hasOptOutAt = await knex.schema.hasColumn('users', 'newsletter_opt_out_at');
  if (!hasOptOutAt) {
    await knex.schema.alterTable('users', (table) => {
      table.timestamp('newsletter_opt_out_at').nullable();
    });
  }

  const hasToken = await knex.schema.hasColumn('users', 'newsletter_unsubscribe_token');
  if (!hasToken) {
    await knex.schema.alterTable('users', (table) => {
      table.string('newsletter_unsubscribe_token', 96).nullable().unique();
    });
  }
};

exports.down = async function(knex) {
  const hasToken = await knex.schema.hasColumn('users', 'newsletter_unsubscribe_token');
  if (hasToken) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('newsletter_unsubscribe_token');
    });
  }

  const hasOptOutAt = await knex.schema.hasColumn('users', 'newsletter_opt_out_at');
  if (hasOptOutAt) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('newsletter_opt_out_at');
    });
  }
};
