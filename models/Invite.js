const knex = require('../db/knex');

const findInviteByCode = async (code) => {
  if (!code) return null;
  return knex('invites').whereRaw('LOWER(code) = ?', code.toLowerCase()).first();
};

const markInviteUsed = async (inviteId) => {
  if (!inviteId) return;
  await knex('invites')
    .where({ id: inviteId })
    .update({
      used_count: knex.raw('used_count + 1'),
      used_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });
};

module.exports = {
  findInviteByCode,
  markInviteUsed,
};
