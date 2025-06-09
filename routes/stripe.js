const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config)
const express = require('express');
const Stripe = require('stripe');
const router = express.Router();
const bodyParser = require('body-parser');

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
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/UserProfile?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/UserProfile?cancelled=true`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe tip session error:', err.message);
    return res.status(500).json({ message: 'Failed to create tip session' });
  }
});

// Stripe webhook route
router.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_email;
    const mode = session.mode;

    try {
      if (mode === 'subscription') {
        // 🎯 Update the user as pro in your DB
        const updated = await knex('users').where({ email }).update({ is_pro: true });
        if (updated) {
          console.log(`✅ Updated is_pro = true for user ${email}`);
        } else {
          console.warn(`⚠️ No user found with email ${email}`);
        }
      }
    } catch (dbErr) {
      console.error('❌ DB update failed:', dbErr.message);
    }
  }

  res.status(200).json({ received: true });
});

module.exports = router;
