const express = require('express');
const Stripe = require('stripe');
const router = express.Router();
const knex = require('../db/knex');
const webhookRouter = express.Router(); // << separate router
const bodyParser = require('body-parser');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// 🟣 Tip session
router.post('/create-tip-session', async (req, res) => {
  const { email, mode, amount } = req.body;

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
        purpose: 'support',
        type: mode,
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
webhookRouter.post('/',  bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ Stripe signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('🔔 Stripe Event:', event.type);
  console.log('🧾 Event Payload:', JSON.stringify(event, null, 2));

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerId = session.customer; // Stripe ID, e.g., "cus_XXXX"
    const mode = session.mode;
    const userId = session.metadata?.user_id;
    const customerEmail = session.customer_email || session.customer_details?.email;

    try {
      let updated = 0;

      if (mode === 'subscription') {
        const updateFields = { is_pro: true, trial_ends_at: null, stripe_customer_id: customerId };

        if (userId) {
          updated = await knex('users')
            .where({ id: userId })
            .update(updateFields);
        } else if (customerEmail) {
          updated = await knex('users')
            .whereRaw('LOWER(email) = ?', customerEmail.toLowerCase())
            .update(updateFields);
        }

        if (updated) {
          console.log(`✅ Updated user ${customerEmail || userId} to is_pro = true`);
        } else {
          console.warn(`⚠️ No user found for email ${customerEmail} or id ${userId}`);
        }
      }
    } catch (err) {
      console.error('❌ DB update error:', err.message);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const customerId = subscription.customer;

    try {
      const user = await knex('users')
        .where({ stripe_customer_id: customerId })
        .first();

      if (user) {
        await knex('users')
          .where({ id: user.id })
          .update({
            is_pro: false,
            pro_cancelled_at: new Date(),
          });

        console.log(`🛑 User ${user.email} subscription canceled`);
      } else {
        console.warn(`⚠️ No user found with stripe_customer_id: ${customerId}`);
      }
    } catch (err) {
      console.error('❌ Error handling subscription.deleted:', err.message);
    }
  }

  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object;
    const customerId = subscription.customer;

    const canceled = subscription.cancel_at_period_end || subscription.status === 'canceled';

    if (canceled) {
      try {
        const user = await knex('users')
          .where({ stripe_customer_id: customerId })
          .first();

        if (user) {
          await knex('users')
            .where({ id: user.id })
            .update({
              is_pro: false,
              pro_cancelled_at: new Date(),
            });

          console.log(`🛑 User ${user.email} subscription marked as canceled (soft cancel)`);
        }
      } catch (err) {
        console.error('❌ Error handling subscription.updated:', err.message);
      }
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
