const knex = require('../db/knex');

const createTip = async ({
  tipperUserId,
  artistId = null,
  amountCents,
  stripeSessionId,
  stripePaymentIntentId,
  source,
}) => {
  const tipData = {
    tipper_user_id: tipperUserId || null,
    artist_id: artistId || null,
    amount_cents: amountCents,
    stripe_session_id: stripeSessionId || null,
    stripe_payment_intent_id: stripePaymentIntentId || null,
    source: source || 'profile',
  };

  if (!stripeSessionId) {
    const [tip] = await knex('tips').insert(tipData).returning('*');
    return tip;
  }

  return knex.transaction(async (trx) => {
    // Stripe retries webhooks. Serialize writes for a Checkout Session so a
    // retry cannot create a second tip even before a database unique index exists.
    await trx.raw('select pg_advisory_xact_lock(hashtext(?))', [stripeSessionId]);
    const existing = await trx('tips')
      .where({ stripe_session_id: stripeSessionId })
      .first();
    if (existing) return existing;

    const [tip] = await trx('tips').insert(tipData).returning('*');
    return tip;
  });
};

module.exports = {
  createTip,
};
