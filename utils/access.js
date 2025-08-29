// utils/access.js
const knex = require('../db/knex');

function trialIsActive(trial_ends_at) {
  return !!trial_ends_at && new Date(trial_ends_at) > new Date();
}

async function hasProAccess(userId) {
  const user = await knex('users')
    .first('is_pro', 'trial_ends_at')
    .where({ id: userId });

  const now = new Date();
  const trialActive = !!user?.trial_ends_at && new Date(user.trial_ends_at) > now;

  return !!user?.is_pro || trialActive;
}


// flip listing for all artists owned by user based on access
async function recalcListingForUser(userId) {
  const access = await hasProAccess(userId);
  const ts = new Date();

  // Unlist everything first (safe default)
  await knex('artists')
    .where({ user_id: userId })
    .whereNull('deleted_at')
    .update({ is_listed: false, updated_at: ts });

  // Only list approved artists if the user has access
  if (access) {
    await knex('artists')
      .where({ user_id: userId, is_approved: true })
      .whereNull('deleted_at')
      .update({ is_listed: true, updated_at: ts });
  }

  return access;
}


module.exports = { hasProAccess, recalcListingForUser, trialIsActive };
