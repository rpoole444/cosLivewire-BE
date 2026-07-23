const assert = require('assert');
const {
  canEditEvent,
  eventResponseForUser,
  isApprovedEvent,
} = require('../utils/eventAccess');

const event = {
  id: 12,
  is_approved: true,
  user_id: 10,
  user: { email: 'private@example.com' },
  user_email: 'private@example.com',
  claimed_by_user_id: 11,
  claimed_by_user_email: 'claim@example.com',
  venue_profile_user_id: 20,
  claimed_artist: { id: 30, user_id: 30, display_name: 'Band' },
  data_quality_reviewed_by: 99,
};

assert.strictEqual(canEditEvent(event, null), false);
assert.strictEqual(canEditEvent(event, { id: 10 }), true);
assert.strictEqual(canEditEvent(event, { id: '20' }), true);
assert.strictEqual(canEditEvent(event, { id: 30 }), true);
assert.strictEqual(canEditEvent(event, { id: 40, is_admin: true }), true);
assert.strictEqual(canEditEvent(event, { id: 40 }), false);

assert.strictEqual(isApprovedEvent(event), true);
assert.strictEqual(isApprovedEvent({ is_approved: false }), false);

const publicResponse = eventResponseForUser(event, null);
assert.strictEqual(publicResponse.can_edit_event, false);
assert.strictEqual(publicResponse.can_delete_event, false);
assert.strictEqual(publicResponse.user_id, undefined);
assert.strictEqual(publicResponse.user, undefined);
assert.strictEqual(publicResponse.claimed_by_user_email, undefined);
assert.strictEqual(publicResponse.claimed_artist.user_id, undefined);
assert.strictEqual(publicResponse.data_quality_reviewed_by, undefined);
assert.strictEqual(publicResponse.claimed_artist.display_name, 'Band');

const ownerResponse = eventResponseForUser(event, { id: 10 });
assert.strictEqual(ownerResponse.can_edit_event, true);
assert.strictEqual(ownerResponse.user_id, 10);
assert.strictEqual(ownerResponse.user.email, 'private@example.com');

console.log('eventAccess tests passed');
