const express = require('express');
const Stripe = require('stripe');
const router = express.Router();
const knex = require('../db/knex');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Create a checkout session for one-time or recurring tips
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
router.post('/webhook', async (req, res) => {
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
    const mode = session.mode;
    const userId = session.metadata?.user_id;
    const customerEmail = session.customer_email || session.customer_details?.email;

    try {
      let updated = 0;

      if (mode === 'subscription') {
        if (customerEmail) {
          updated = await knex('users')
            .whereRaw('LOWER(email) = ?', customerEmail.toLowerCase())
            .update({ is_pro: true, trial_ends_at: null });
        } else if (userId) {
          updated = await knex('users')
            .where({ id: userId })
            .update({ is_pro: true, trial_ends_at: null });
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

  res.status(200).json({ received: true });
});


module.exports = router;
