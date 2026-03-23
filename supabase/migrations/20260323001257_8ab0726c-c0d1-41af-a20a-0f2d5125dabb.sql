CREATE POLICY credit_transactions_no_insert ON credit_transactions
  FOR INSERT TO authenticated, anon
  WITH CHECK (false);

CREATE POLICY credit_transactions_no_update ON credit_transactions
  FOR UPDATE TO authenticated, anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY credit_transactions_no_delete ON credit_transactions
  FOR DELETE TO authenticated, anon
  USING (false);