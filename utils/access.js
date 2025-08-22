// utils/access.js
const knex = require('../db/knex');

function trialIsActive(trial_ends_at) {
  return !!trial_ends_at && new Date(trial_ends_at) > new Date();
}

async function hasProAccess(userId) {
  const u = await knex('users').where({ id: userId }).first();
  if (!u) return false;
  return !!u.is_pro || trialIsActive(u.trial_ends_at);
}

// flip listing for all artists owned by user based on access
async function recalcListingForUser(userId) {
  const access = await hasProAccess(userId);
  await knex('artists')
    .where({ user_id: userId })
    .andWhereNull('deleted_at')
    .update({
      is_listed: access,     // true if Pro or active trial, else false
      updated_at: new Date(),
    });
  return access;
}

module.exports = { hasProAccess, recalcListingForUser, trialIsActive };
