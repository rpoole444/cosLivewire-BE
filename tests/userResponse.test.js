const assert = require('assert');
const { userResponse } = require('../utils/userResponse');

const response = userResponse({
  id: 4,
  email: 'artist@example.com',
  first_name: 'Artist',
  is_admin: false,
  password: 'hashed-password',
  reset_token: 'hashed-reset-token',
  reset_token_expires: new Date(),
  newsletter_unsubscribe_token: 'private-token',
  stripe_customer_id: 'cus_private',
});

assert.deepStrictEqual(response, {
  id: 4,
  first_name: 'Artist',
  email: 'artist@example.com',
  is_admin: false,
});
assert.strictEqual(userResponse(null), null);

console.log('userResponse tests passed');
