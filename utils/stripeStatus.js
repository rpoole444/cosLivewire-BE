const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'];

/**
 * Given a Stripe subscription object, compute the pro access flags we should store.
 * Business rules:
 * - active/trialing subscriptions keep pro access
 * - cancel_at_period_end keeps pro access until the current period end, but records when access ends
 * - canceled or inactive subscriptions immediately lose pro and record when the cancellation happened
 *
 * @param {import('stripe').Stripe.Subscription} subscription
 * @returns {{ isPro: boolean, proCancelledAt: Date | null }}
 */
function computeProStatusFromSubscription(subscription) {
  if (!subscription || typeof subscription !== 'object') {
    return { isPro: false, proCancelledAt: null };
  }

  const status = subscription.status;
  const isPro = ACTIVE_SUBSCRIPTION_STATUSES.includes(status);

  let proCancelledAt = null;

  if (subscription.cancel_at_period_end) {
    const cancelTimestamp = subscription.cancel_at || subscription.current_period_end;
    if (cancelTimestamp) {
      proCancelledAt = new Date(cancelTimestamp * 1000);
    }
  }

  if (!isPro) {
    if (subscription.canceled_at) {
      proCancelledAt = new Date(subscription.canceled_at * 1000);
    } else if (!proCancelledAt) {
      proCancelledAt = new Date();
    }
  } else if (!subscription.cancel_at_period_end) {
    proCancelledAt = null;
  }

  return { isPro, proCancelledAt };
}

module.exports = {
  computeProStatusFromSubscription,
  ACTIVE_SUBSCRIPTION_STATUSES,
};
