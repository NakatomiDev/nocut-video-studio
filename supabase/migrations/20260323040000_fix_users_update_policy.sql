-- Fix: Prevent authenticated users from updating tier column entirely
-- The previous WITH CHECK subquery approach is bypassable due to
-- same-transaction read-after-write in PostgreSQL RLS evaluation.

-- 1. Drop the current policy
DROP POLICY IF EXISTS users_update_own ON users;

-- 2. Recreate with simple ownership check (column grants handle tier protection)
CREATE POLICY users_update_own ON users
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 3. Revoke UPDATE on tier from authenticated users
REVOKE UPDATE (tier) ON users FROM authenticated;

-- 4. Explicitly grant UPDATE only on safe columns
GRANT UPDATE (email, revenuecat_id, updated_at) ON users TO authenticated;
