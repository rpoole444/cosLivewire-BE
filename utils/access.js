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
  const user = await knex('users')
    .first('id', 'email', 'is_pro', 'pro_cancelled_at')
    .where({ id: userId });
  if (!user) {
    console.warn('[recalcListingForUser] No user found for id', userId);
    return false;
  }

  const now = new Date();
  const proActive =
    !!user.is_pro &&
    (!user.pro_cancelled_at || new Date(user.pro_cancelled_at) > now);

  const access = await hasProAccess(userId);
  const ts = new Date();

  const artistUpdates = {
    is_pro: proActive,
    updated_at: ts,
  };
  if (proActive) {
    artistUpdates.trial_active = false;
  }

  await knex('artists')
    .where({ user_id: userId })
    .update(artistUpdates);

  console.log(
    '[recalcListingForUser] user=',
    user.email,
    'proActive=',
    proActive,
    ' -> updated artists.is_pro/trial_active'
  );

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
