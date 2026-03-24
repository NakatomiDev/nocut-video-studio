-- Add Stripe subscription tracking columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

-- Index for webhook lookups by Stripe customer ID
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer
  ON users (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
