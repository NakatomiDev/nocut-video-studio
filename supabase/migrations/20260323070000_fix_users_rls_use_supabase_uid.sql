-- Fix: RLS policies should compare auth.uid() against supabase_uid, not id
-- supabase_uid is the column explicitly designated for the Supabase auth UID

DROP POLICY IF EXISTS users_select_own ON users;
CREATE POLICY users_select_own ON users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = supabase_uid);

DROP POLICY IF EXISTS users_update_own ON users;
CREATE POLICY users_update_own ON users
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = supabase_uid)
  WITH CHECK (auth.uid() = supabase_uid);
