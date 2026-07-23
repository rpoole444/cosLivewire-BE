const assert = require('assert');
const { profileResponseForUser } = require('../utils/profileAccess');

const profile = {
  id: 1,
  display_name: 'Room',
  stripe_customer_id: 'cus_private',
  shell_created_by_user_id: 2,
  venue_load_in: 'Back door',
  venue_parking: 'Alley',
  venue_green_room: 'Upstairs',
  venue_booking_policy: 'Email first',
};

const publicResponse = profileResponseForUser(profile, null);
assert.strictEqual(publicResponse.stripe_customer_id, undefined);
assert.strictEqual(publicResponse.shell_created_by_user_id, undefined);
assert.strictEqual(publicResponse.venue_load_in, undefined);

const loggedInResponse = profileResponseForUser(profile, { id: 9 });
assert.strictEqual(loggedInResponse.stripe_customer_id, undefined);
assert.strictEqual(loggedInResponse.venue_load_in, 'Back door');

console.log('profileAccess tests passed');
