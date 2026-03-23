-- Security fix: Block direct client INSERT/UPDATE/DELETE on ai_fills table.
--
-- The ai_fills_insert_own and ai_fills_update_own RLS policies allow any
-- project-owner to INSERT or UPDATE ai_fill rows, enabling injection of
-- arbitrary s3_key values, fake quality_score/provider metadata, and
-- tampering with records consumed by the export pipeline.
--
-- The ai_fills_delete_own policy allows deleting fill records, which could
-- break in-progress exports that depend on those s3_key references.
--
-- All legitimate ai_fills writes happen server-side via the process-ai-fill
-- edge function and ai-engine service, both using service_role clients that
-- bypass RLS. All client-side code only performs SELECT on ai_fills.
-- CASCADE delete on edit_decision_id handles cleanup when projects are deleted.

-- =============================================================================
-- 1. ai_fills — deny INSERT from authenticated / anon
-- =============================================================================
DROP POLICY IF EXISTS ai_fills_insert_own ON ai_fills;

CREATE POLICY ai_fills_no_insert ON ai_fills
    FOR INSERT TO authenticated, anon
    WITH CHECK (false);

-- =============================================================================
-- 2. ai_fills — deny UPDATE from authenticated / anon
-- =============================================================================
DROP POLICY IF EXISTS ai_fills_update_own ON ai_fills;

CREATE POLICY ai_fills_no_update ON ai_fills
    FOR UPDATE TO authenticated, anon
    USING (false)
    WITH CHECK (false);

-- =============================================================================
-- 3. ai_fills — deny DELETE from authenticated / anon
--    (defense-in-depth; CASCADE handles legitimate cleanup)
-- =============================================================================
DROP POLICY IF EXISTS ai_fills_delete_own ON ai_fills;

CREATE POLICY ai_fills_no_delete ON ai_fills
    FOR DELETE TO authenticated, anon
    USING (false);
