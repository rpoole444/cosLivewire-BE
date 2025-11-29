exports.seed = async function (knex) {
  const code = 'FOUNDER3M';
  const existing = await knex('invites').where({ code }).first();
  if (existing) return;

  await knex('invites').insert({
    code,
    trial_days: 90,
    max_uses: 50,
  });
};
