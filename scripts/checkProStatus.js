#!/usr/bin/env node

const knex = require('../db/knex');

const identifier = process.argv[2];

if (!identifier) {
  console.error('Usage: node scripts/checkProStatus.js <userId|email>');
  process.exit(1);
}

async function run() {
  let userQuery = knex('users');

  if (/^\d+$/.test(identifier)) {
    userQuery = userQuery.where({ id: Number(identifier) });
  } else {
    userQuery = userQuery.whereRaw('LOWER(email) = ?', identifier.toLowerCase());
  }

  const user = await userQuery.first();

  if (!user) {
    console.log('User not found for identifier:', identifier);
    return;
  }

  console.log('User:', {
    id: user.id,
    email: user.email,
    is_pro: user.is_pro,
    stripe_customer_id: user.stripe_customer_id,
    trial_ends_at: user.trial_ends_at,
    pro_cancelled_at: user.pro_cancelled_at,
  });
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
