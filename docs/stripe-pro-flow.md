# Stripe Pro Subscription Manual Checks

These steps verify the backend keeps the `users` table in sync with Stripe.

1. **New subscription**
   - Start from a user with `is_pro = false` and `stripe_customer_id = NULL`.
   - Run through Stripe Checkout in test mode.
   - After the webhook fires, verify the DB row shows:
     - `stripe_customer_id` populated.
     - `is_pro = true`.
     - `pro_cancelled_at = NULL`.
   - Call `/api/auth/session` and confirm the response shows the same fields.

2. **Cancel at period end**
   - In the Stripe Dashboard, set the subscription to cancel at the end of the period (or send a test `customer.subscription.updated` event with `cancel_at_period_end = true`).
   - After the webhook, confirm the user row has:
     - `is_pro = true`.
     - `pro_cancelled_at` equals the subscription’s `current_period_end`.

3. **Immediate cancellation**
   - Cancel the subscription immediately (or send `customer.subscription.deleted`).
   - After the webhook, confirm:
     - `is_pro = false`.
     - `pro_cancelled_at` equals Stripe’s `canceled_at` (or the timestamp of the webhook event).
   - Hit `/api/auth/session` again; it should reflect `is_pro = false`.

4. **Re-run checkout**
   - Subscribe the same user again to ensure the webhook sets `is_pro = true`, clears `pro_cancelled_at`, and reuses the stored `stripe_customer_id`.

Use `npm run check-pro-status -- <userId|email>` for a quick CLI view of the stored values.
