exports.up = async function (knex) {
  const hasTrialActive = await knex.schema.hasColumn('users', 'trial_active');
  if (hasTrialActive) {
    await knex.schema.alterTable('users', (table) => {
      table.boolean('trial_active').defaultTo(false).alter();
    });
  }

  const hasTrialEndsAt = await knex.schema.hasColumn('users', 'trial_ends_at');
  if (hasTrialEndsAt) {
    await knex.raw(`
      ALTER TABLE users
      ALTER COLUMN trial_ends_at DROP DEFAULT
    `);
  }
};

exports.down = async function (knex) {
  // No-op; we do not want to reintroduce old defaults.
};
