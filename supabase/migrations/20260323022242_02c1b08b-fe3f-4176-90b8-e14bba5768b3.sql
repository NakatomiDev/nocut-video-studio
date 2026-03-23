-- Drop the existing permissive update policy
DROP POLICY IF EXISTS users_update_own ON users;

-- Recreate with a guard: tier must remain unchanged
CREATE POLICY users_update_own ON users
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND tier = (SELECT u.tier FROM users u WHERE u.id = auth.uid())
  );