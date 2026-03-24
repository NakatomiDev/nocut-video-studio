
DROP POLICY IF EXISTS ai_fills_insert_own ON ai_fills;
DROP POLICY IF EXISTS ai_fills_update_own ON ai_fills;

CREATE POLICY ai_fills_no_insert ON ai_fills
  FOR INSERT TO authenticated, anon
  WITH CHECK (false);

CREATE POLICY ai_fills_no_update ON ai_fills
  FOR UPDATE TO authenticated, anon
  USING (false);
