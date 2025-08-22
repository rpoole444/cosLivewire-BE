const express = require('express');
const Stripe = require('stripe');
const router = express.Router();
const knex = require('../db/knex');
const webhookRouter = express.Router(); // << separate router
const bodyParser = require('body-parser');
const { recalcListingForUser } = require('../utils/access'); // <- add this

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// 🟣 Tip session
router.post('/create-tip-session', async (req, res) => {
  const { email, mode, amount, plan} = req.body;

  if (!email || !mode || !amount) {
    return res.status(400).json({ message: 'Missing required info: email, mode, amount' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode, // 'payment' for one-time, 'subscription' for monthly
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: amount * 100, // e.g. 700 → $7.00
            product_data: {
              name: mode === 'subscription' ? 'Monthly Supporter Tip' : 'One-Time Tip',
              description: mode === 'subscription'
                ? 'Monthly tip to support Alpine Groove Guide. Cancel anytime.'
                : 'One-time thank-you tip to support the platform.',
            },
            recurring: mode === 'subscription' ? { interval: 'month' } : undefined,
          },
          quantity: 1,
        },
      ],
      metadata: {
        user_id: userId,
        plan,
        purpose: 'support',
        type: mode,
        intent: 'publish_artist',
        artist_id: String(artistId || ''),
      },
      automatic_tax: { enabled: true }, 
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/UserProfile?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/UserProfile?cancelled=true`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe tip session error:', err.message);
    return res.status(500).json({ message: 'Failed to create tip session' });
  }
});

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
    // if you also track trial flags, include them here
if (user.is_pro || user.trial_ends_at && user.trial_ends_at > new Date()) {
  return res.status(409).json({ message: 'Already Pro. No checkout needed.' });
}


    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: user.email,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      metadata: {
        user_id: userId,
        plan,
      },
      automatic_tax: { enabled: true }, 
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/UserProfile?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/UserProfile?canceled=true`,
    });

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

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ Stripe signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const eventType = event.type;
  const data = event.data.object;

  console.log('🔔 Stripe Event Received:', eventType);

  // ---------------------
  // 1️⃣ Subscription Created
  // ---------------------
  if (eventType === 'checkout.session.completed') {
    const { customer: customerId, mode, metadata, customer_email } = data;
    const userId = metadata?.user_id;

    if (mode !== 'subscription') return res.status(200).send('Not a subscription');

    if (!userId && !customer_email) {
      console.warn(`⚠️ No userId or customer_email in metadata`);
      return res.status(400).send('Missing user identification');
    }

    try {
      let user;
      const updateFields = {
        is_pro: true,
        trial_ends_at: null,
        stripe_customer_id: customerId,
        pro_cancelled_at: null,
      };

      if (userId) {
        await knex('users').where({ id: userId }).update(updateFields);
        user = await knex('users').where({ id: userId }).first();
      } else {
        await knex('users')
          .whereRaw('LOWER(email) = ?', customer_email.toLowerCase())
          .update(updateFields);
        user = await knex('users')
          .whereRaw('LOWER(email) = ?', customer_email.toLowerCase())
          .first();
      }

      if (user) {
        await knex('artists')
          .where({ user_id: user.id })
          .update({
            is_pro: true,
            trial_active: false,
            updated_at: new Date(),
          });
      await recalcListingForUser(user.id);

        console.log(`✅ Created subscription for ${user.email || user.id}`);
      } else {
        console.warn(`⚠️ User not found for checkout.session.completed`);
      }
    } catch (err) {
      console.error('❌ DB update error:', err.message);
    }
  }

  // ---------------------
  // 2️⃣ Subscription Cancelled Immediately
  // ---------------------
  if (eventType === 'customer.subscription.deleted') {
    const { customer: customerId } = data;

    try {
      const user = await knex('users').where({ stripe_customer_id: customerId }).first();
      if (!user) return console.warn(`⚠️ No user found with stripe_customer_id: ${customerId}`);

      await knex('users').where({ id: user.id }).update({
        is_pro: false,
        pro_cancelled_at: new Date(),
      });

      await recalcListingForUser(user.id);

      console.log(`🛑 Subscription deleted: ${user.email}`);
    } catch (err) {
      console.error('❌ Error in subscription.deleted handler:', err.message);
    }
  }

  // ---------------------
  // 3️⃣ Subscription Updated (cancel_at_period_end)
  // ---------------------
  if (eventType === 'customer.subscription.updated') {
    const {
      customer: customerId,
      cancel_at_period_end,
      current_period_end,
      status,
    } = data;

    try {
      const user = await knex('users').where({ stripe_customer_id: customerId }).first();
      if (!user) {
        console.warn(`⚠️ No user found for customer: ${customerId}`);
        return res.status(404).send('User not found');
      }

      console.log(`🌀 Sub updated for ${user.email}: cancel_at_period_end=${cancel_at_period_end}, status=${status}`);

      if (cancel_at_period_end) {
        const cancelDate = new Date(current_period_end * 1000);
        await knex('users').where({ id: user.id }).update({ pro_cancelled_at: cancelDate });

        console.log(`⏰ Scheduled cancellation for ${user.email} at ${cancelDate.toISOString()}`);
      } else if (status === 'canceled') {
        // Fallback safety in case Stripe skips subscription.deleted
        await knex('users')
          .where({ id: user.id })
          .update({
            is_pro: false,
            pro_cancelled_at: new Date(),
          });

        await recalcListingForUser(user.id);

        console.log(`🚫 Marked user as canceled in updated event: ${user.email}`);
      }
    } catch (err) {
      console.error('❌ Error in subscription.updated handler:', err.message);
    }
  }

  res.status(200).json({ received: true });
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
      return_url: `${process.env.NEXT_PUBLIC_SITE_URL}/UserProfile`,
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
