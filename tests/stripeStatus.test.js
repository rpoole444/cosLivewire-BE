const assert = require('assert');
const { computeProStatusFromSubscription } = require('../utils/stripeStatus');

const nowSeconds = Math.floor(Date.now() / 1000);

const activeSubscription = {
  status: 'active',
  cancel_at_period_end: false,
};

const trialCancelSubscription = {
  status: 'trialing',
  cancel_at_period_end: true,
  cancel_at: nowSeconds + 7200,
  current_period_end: nowSeconds + 3600,
};

const canceledSubscription = {
  status: 'canceled',
  cancel_at_period_end: false,
  canceled_at: nowSeconds - 60,
};

const incompleteExpiredSubscription = {
  status: 'incomplete_expired',
  cancel_at_period_end: false,
};

const resultActive = computeProStatusFromSubscription(activeSubscription);
assert.strictEqual(resultActive.isPro, true, 'Active subscription should be pro');
assert.strictEqual(resultActive.proCancelledAt, null, 'Active subscription should not have cancel date');

const resultTrialCancel = computeProStatusFromSubscription(trialCancelSubscription);
assert.strictEqual(resultTrialCancel.isPro, true, 'Trialing subscription should be pro');
assert(resultTrialCancel.proCancelledAt instanceof Date, 'Cancel at period end sets a date');
assert(
  Math.abs(resultTrialCancel.proCancelledAt.getTime() - trialCancelSubscription.cancel_at * 1000) < 5,
  'Cancel date should prefer cancel_at when provided'
);

const fallbackCancelSubscription = {
  status: 'active',
  cancel_at_period_end: true,
  current_period_end: nowSeconds + 1800,
};

const resultFallbackCancel = computeProStatusFromSubscription(fallbackCancelSubscription);
assert(
  Math.abs(resultFallbackCancel.proCancelledAt.getTime() - fallbackCancelSubscription.current_period_end * 1000) < 5,
  'Cancel date should fall back to current_period_end when cancel_at missing'
);

const resultCanceled = computeProStatusFromSubscription(canceledSubscription);
assert.strictEqual(resultCanceled.isPro, false, 'Canceled subscription should not be pro');
assert(resultCanceled.proCancelledAt instanceof Date, 'Canceled subscription should have cancel date');

const resultIncomplete = computeProStatusFromSubscription(incompleteExpiredSubscription);
assert.strictEqual(resultIncomplete.isPro, false, 'inactive statuses should not be pro');
assert(resultIncomplete.proCancelledAt instanceof Date, 'Inactive subscription should set cancel date fallback');

console.log('computeProStatusFromSubscription tests passed.');
