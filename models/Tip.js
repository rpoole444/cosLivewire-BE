const knex = require('../db/knex');

const createTip = async ({
  tipperUserId,
  artistId = null,
  amountCents,
  stripeSessionId,
  stripePaymentIntentId,
  source,
}) => {
  const [tip] = await knex('tips')
    .insert({
      tipper_user_id: tipperUserId || null,
      artist_id: artistId || null,
      amount_cents: amountCents,
      stripe_session_id: stripeSessionId || null,
      stripe_payment_intent_id: stripePaymentIntentId || null,
      source: source || 'profile',
    })
    .returning('*');

  return tip;
};

module.exports = {
  createTip,
};
