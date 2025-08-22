// migrations/202508221915_add_is_listed_to_artists.js
exports.up = async function(knex) {
  const has = await knex.schema.hasColumn('artists', 'is_listed');
  if (!has) {
    await knex.schema.alterTable('artists', (t) => {
      t.boolean('is_listed').notNullable().defaultTo(false);
    });
  }

  // Optional: ensure columns you reference exist (guarded)
  const hasTrialActive = await knex.schema.hasColumn('artists', 'trial_active');
  if (!hasTrialActive) {
    await knex.schema.alterTable('artists', (t) => {
      t.boolean('trial_active').defaultTo(false);
    });
  }
  const hasTrialStart = await knex.schema.hasColumn('artists', 'trial_start_date');
  if (!hasTrialStart) {
    await knex.schema.alterTable('artists', (t) => {
      t.timestamp('trial_start_date');
    });
  }
};

exports.down = async function(knex) {
  const has = await knex.schema.hasColumn('artists', 'is_listed');
  if (has) {
    await knex.schema.alterTable('artists', (t) => {
      t.dropColumn('is_listed');
    });
  }
  // (You can drop trial columns too if you created them above)
};
