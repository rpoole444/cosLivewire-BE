// utils/access.js
const knex = require('../db/knex');

const ACCESS_STATES = {
  PRO: 'pro',
  TRIAL: 'trial',
  GATED: 'gated',
  NONE: 'none',
};

function trialIsActive(trial_ends_at, now = new Date()) {
  return !!trial_ends_at && new Date(trial_ends_at) > now;
}

function getArtistAccessState(userLike, now = new Date()) {
  if (!userLike) return ACCESS_STATES.NONE;

  const { is_pro, trial_ends_at, pro_cancelled_at, stripe_customer_id } = userLike;
  const trialActive = trialIsActive(trial_ends_at, now);

  if (is_pro) return ACCESS_STATES.PRO;
  if (trialActive) return ACCESS_STATES.TRIAL;

  const hadAccessBefore = !!pro_cancelled_at || !!trial_ends_at || !!stripe_customer_id;
  if (hadAccessBefore) {
    return ACCESS_STATES.GATED;
  }

  return ACCESS_STATES.NONE;
}

async function hasProAccess(userId) {
  const user = await knex('users')
    .first('is_pro', 'trial_ends_at')
    .where({ id: userId });

  const trialActive = trialIsActive(user?.trial_ends_at);

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
    ' -> synced artist pro flags'
  );

  // Auto-list approved artists when access becomes active, but never unlist automatically.
  const access = await hasProAccess(userId);
  if (access) {
    await knex('artists')
      .where({ user_id: userId, is_approved: true })
      .whereNull('deleted_at')
      .andWhere({ is_listed: false })
      .update({ is_listed: true, updated_at: ts });
  }

  return access;
}


module.exports = {
  hasProAccess,
  recalcListingForUser,
  trialIsActive,
  getArtistAccessState,
  ACCESS_STATES,
};
