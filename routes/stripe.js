const express = require('express');
const Stripe = require('stripe');
const router = express.Router();
const knex = require('../db/knex');
const webhookRouter = express.Router(); // << separate router
const bodyParser = require('body-parser');
const { recalcListingForUser } = require('../utils/access'); // <- add this
const { computeProStatusFromSubscription } = require('../utils/stripeStatus');
const { createTip } = require('../models/Tip');

/**
 * Stripe integration notes:
 * - `/create-checkout-session` spins up subscription-mode Checkout sessions for Alpine Pro
 * - `/billing-portal` issues Billing Portal sessions so users can manage/cancel
 * - `/api/payments/webhook` listens to checkout + subscription lifecycle events and keeps the
 *   `users` table in sync. We treat subscriptions as Pro while status is `active` or `trialing`.
 *   If a user schedules a cancellation (cancel_at_period_end), we store that future timestamp in
 *   `pro_cancelled_at`. When Stripe reports the subscription as canceled/inactive we clear Pro access
 *   and record when it ended.
 */
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

const STRIPE_LOG_PREFIX = '[stripe-webhook]';

const getCustomerIdFromSubscription = (subscription) => {
  if (!subscription) return null;
  if (typeof subscription.customer === 'string') return subscription.customer;
  return subscription.customer?.id || null;
};

const updateArtistProState = async (userId, isPro) => {
  const update = {
    is_pro: isPro,
    updated_at: new Date(),
  };

  if (isPro) {
    update.trial_active = false;
  }

  await knex('artists').where({ user_id: userId }).update(update);
  await recalcListingForUser(userId);
};

const syncUserWithSubscription = async (subscription, explicitUser) => {
  const customerId = getCustomerIdFromSubscription(subscription);
  if (!customerId && !explicitUser) {
    console.warn(`${STRIPE_LOG_PREFIX} missing customer id on subscription`, {
      subscriptionId: subscription?.id,
    });
    return;
  }

  let user = explicitUser;
  if (!user && customerId) {
    user = await knex('users').where({ stripe_customer_id: customerId }).first();
  }

  if (!user) {
    console.warn(`${STRIPE_LOG_PREFIX} no user found for subscription`, {
      subscriptionId: subscription?.id,
      customerId,
    });
    return;
  }

  const { isPro, proCancelledAt } = computeProStatusFromSubscription(subscription);

  const userUpdates = {
    is_pro: isPro,
    pro_cancelled_at: proCancelledAt,
    stripe_customer_id: customerId || user.stripe_customer_id,
    updated_at: knex.fn.now(),
  };

  if (isPro) {
    userUpdates.trial_ends_at = null;
  }

  await knex('users').where({ id: user.id }).update(userUpdates);

  await updateArtistProState(user.id, isPro);

  console.log(`${STRIPE_LOG_PREFIX} updated user`, user.id, {
    isPro,
    proCancelledAt,
    subscriptionId: subscription?.id,
    status: subscription?.status,
  });
};

const findUserForCheckoutSession = async (sessionCustomerId, session) => {
  const metadataUserId = session.metadata?.userId || session.metadata?.user_id;
  if (metadataUserId) {
    const user = await knex('users').where({ id: metadataUserId }).first();
    if (user) return user;
  }

  if (sessionCustomerId) {
    const user = await knex('users').where({ stripe_customer_id: sessionCustomerId }).first();
    if (user) return user;
  }

  const email =
    session.customer_details?.email ||
    session.customer_email ||
    session.metadata?.email ||
    null;

  if (email) {
    const user = await knex('users')
      .whereRaw('LOWER(email) = ?', email.toLowerCase())
      .first();
    if (user) return user;
  }

  return null;
};

const handleCheckoutSessionCompleted = async (session) => {
  if (session.mode === 'subscription') {
    const sessionCustomerId =
      typeof session.customer === 'string' ? session.customer : session.customer?.id;
    const user = await findUserForCheckoutSession(sessionCustomerId, session);

    if (!user) {
      console.warn(`${STRIPE_LOG_PREFIX} checkout session without matching user`, {
        sessionId: session.id,
        customerId: sessionCustomerId,
      });
      return;
    }

    if (sessionCustomerId && user.stripe_customer_id !== sessionCustomerId) {
      await knex('users')
        .where({ id: user.id })
        .update({
          stripe_customer_id: sessionCustomerId,
          updated_at: knex.fn.now(),
        });
      user.stripe_customer_id = sessionCustomerId;
      console.log(`${STRIPE_LOG_PREFIX} stored stripe_customer_id for user`, user.id, {
        customerId: sessionCustomerId,
      });
    }

    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id;

    if (!subscriptionId) {
      console.warn(`${STRIPE_LOG_PREFIX} checkout session missing subscription`, {
        sessionId: session.id,
      });
      return;
    }

    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await syncUserWithSubscription(subscription, user);
    } catch (err) {
      console.error(`${STRIPE_LOG_PREFIX} failed to retrieve subscription`, {
        subscriptionId,
        error: err.message,
      });
    }
  } else if (session.mode === 'payment' && session.metadata?.intent === 'platform_tip') {
    await recordPlatformTipFromSession(session);
  } else {
    console.log(`${STRIPE_LOG_PREFIX} checkout session ignored`, {
      sessionId: session.id,
      mode: session.mode,
      metadataIntent: session.metadata?.intent,
    });
  }
};

const recordPlatformTipFromSession = async (session) => {
  const metadata = session.metadata || {};
  let tipAmountCents = metadata.tip_amount_cents ? Number(metadata.tip_amount_cents) : null;

  if (!tipAmountCents || Number.isNaN(tipAmountCents)) {
    tipAmountCents = session.amount_total || null;
  }

  if (!tipAmountCents) {
    console.warn(`${STRIPE_LOG_PREFIX} platform tip session missing amount`, {
      sessionId: session.id,
    });
    return;
  }

  let tipperUserId = metadata.tipper_user_id ? Number(metadata.tipper_user_id) : null;

  if (!tipperUserId) {
    const sessionCustomerId =
      typeof session.customer === 'string' ? session.customer : session.customer?.id;
    const fallbackUser = await findUserForCheckoutSession(sessionCustomerId, session);
    tipperUserId = fallbackUser?.id || null;
  }

  const source = metadata.source === 'public' ? 'public' : 'profile';

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id || null;

  try {
    await createTip({
      tipperUserId,
      artistId: null,
      amountCents: tipAmountCents,
      stripeSessionId: session.id,
      stripePaymentIntentId: paymentIntentId,
      source,
    });

    console.log(`${STRIPE_LOG_PREFIX} recorded platform tip`, {
      tipperUserId,
      amountCents: tipAmountCents,
      sessionId: session.id,
      source,
    });
  } catch (err) {
    console.error(`${STRIPE_LOG_PREFIX} failed to record platform tip`, {
      sessionId: session.id,
      error: err,
    });
  }
};

const handleSubscriptionLifecycleEvent = async (eventType, subscription) => {
  const customerId = getCustomerIdFromSubscription(subscription);
  console.log(`${STRIPE_LOG_PREFIX} event`, eventType, {
    customerId,
    subscriptionId: subscription?.id,
    status: subscription?.status,
    cancel_at_period_end: subscription?.cancel_at_period_end,
  });
  await syncUserWithSubscription(subscription);
};

// 🟣 Tip session (one-time Checkout payment)
router.post('/create-tip-session', async (req, res) => {
  const rawAmount = Number(req.body.amount);
  const source = req.body.source === 'public' ? 'public' : 'profile';

  if (!rawAmount || Number.isNaN(rawAmount) || rawAmount < 1) {
    return res.status(400).json({ message: 'amount must be at least $1.' });
  }

  const amountCents = Math.round(rawAmount * 100);
  const tipperUserId = req.user?.id || null;
  const customerEmail = req.user?.email || null;

  try {
    const sessionPayload = {
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: amountCents,
            product_data: {
              name: 'Support Alpine Groove Guide',
              description:
                'One-time tip to help keep the Alpine Groove Guide running for local artists and venues.',
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        intent: 'platform_tip',
        tip_amount_cents: String(amountCents),
        tipper_user_id: tipperUserId ? String(tipperUserId) : '',
        source,
      },
      automatic_tax: { enabled: true },
      success_url:
        source === 'public'
          ? `${process.env.NEXT_PUBLIC_SITE_URL}/about?tipSuccess=true`
          : `${process.env.NEXT_PUBLIC_SITE_URL}/UserProfile?tipSuccess=true`,
      cancel_url:
        source === 'public'
          ? `${process.env.NEXT_PUBLIC_SITE_URL}/about?tipCancelled=true`
          : `${process.env.NEXT_PUBLIC_SITE_URL}/UserProfile?tipCancelled=true`,
    };

    if (customerEmail) {
      sessionPayload.customer_email = customerEmail;
    }

    const session = await stripe.checkout.sessions.create(sessionPayload);

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe tip session error:', err);
    return res.status(500).json({ message: 'Failed to create tip session' });
  }
});

/**
 * Manual QA for platform tips:
 * - From a logged-in UserProfile: POST /api/payments/create-tip-session { amount: 7, source: 'profile' }, complete checkout, confirm redirect with tipSuccess=true and DB row with source=profile.
 * - From the public About/support page (logged out): POST /api/payments/create-tip-session { amount: 5, source: 'public' }, complete checkout, confirm redirect to /about?tipSuccess=true and DB row with source=public & tipper_user_id null.
 */

// Create a subscription checkout session
router.post('/create-checkout-session', async (req, res) => {
  console.log('BODY RECEIVED:', req.body);
  const { userId, plan } = req.body;

  if (!userId || !plan) {
    return res.status(400).json({ message: 'Missing required data: userId and plan' });
  }

  const monthlyPriceId = process.env.STRIPE_MONTHLY_PRICE_ID;
  const annualPriceId = process.env.STRIPE_ANNUAL_PRICE_ID;
  const priceId = plan === 'annual' ? annualPriceId : monthlyPriceId;

  if (!priceId) {
    return res.status(500).json({ message: `Missing Stripe price ID for plan: ${plan}` });
  }

  try {
    const user = await knex('users').where({ id: userId }).first();
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (user.is_pro) {
      return res.status(409).json({ message: 'Already Pro. No checkout needed.' });
    }

    const sessionPayload = {
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { userId: String(userId), user_id: String(userId), plan },
      automatic_tax: { enabled: true },
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/UserProfile?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/UserProfile?canceled=true`,
    };

    if (user.stripe_customer_id) {
      sessionPayload.customer = user.stripe_customer_id;
    } else {
      sessionPayload.customer_email = user.email;
    }

    const session = await stripe.checkout.sessions.create(sessionPayload);

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe subscription session error:', err.message);
    return res.status(500).json({ message: 'Failed to create checkout session' });
  }
});


// Stripe webhook route
webhookRouter.post('/', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  if (!stripeWebhookSecret) {
    console.error('❌ STRIPE_WEBHOOK_SECRET is not configured.');
    return res.status(500).send('Stripe webhook misconfiguration');
  }

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, stripeWebhookSecret);
  } catch (err) {
    console.error('❌ Stripe signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const eventType = event.type;
  const data = event.data.object;

  console.log('🔔 Stripe Event Received:', eventType, {
    id: event.id,
    objectId: data?.id,
  });

  try {
    switch (eventType) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(data);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await handleSubscriptionLifecycleEvent(eventType, data);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error(`${STRIPE_LOG_PREFIX} handler error`, err);
  }

  return res.status(200).json({ received: true });
});



router.post('/billing-portal', async (req, res) => {
  const { userId } = req.body;

  try {
    const user = await knex('users').where({ id: userId }).first();

    let customerId = user?.stripe_customer_id;

    if (!customerId) {
      const search = await stripe.customers.search({
        query: `email:'${user.email}'`,
      });

      if (search.data.length > 0) {
        customerId = search.data[0].id;
      } else {
        const customer = await stripe.customers.create({ email: user.email });
        customerId = customer.id;
      }

      await knex('users')
        .where({ id: userId })
        .update({ stripe_customer_id: customerId });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.NEXT_PUBLIC_SITE_URL}/UserProfile?billingUpdate=true`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('❌ Billing portal error:', err.message);
    res.status(500).json({ message: 'Failed to create billing portal session' });
  }
});

module.exports = {
  router,
  webhookRouter,
};
