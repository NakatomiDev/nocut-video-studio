-- Security fix: Block direct client INSERT/UPDATE on edit_decisions and job_queue.
--
-- Previously, RLS allowed any project-owner to INSERT into edit_decisions with
-- arbitrary credits_charged (including 0) and create job_queue rows to trigger
-- process-ai-fill, bypassing credit deduction entirely.
--
-- After this migration, only service_role (used by edge functions) can write to
-- these tables. The legitimate flows (project-edl, process-ai-fill, preview-fill)
-- already use service_role clients.

-- =============================================================================
-- 1. edit_decisions — deny INSERT from authenticated / anon
-- =============================================================================
DROP POLICY IF EXISTS edit_decisions_insert_own ON edit_decisions;

CREATE POLICY edit_decisions_no_insert ON edit_decisions
    FOR INSERT TO authenticated, anon
    WITH CHECK (false);

-- =============================================================================
-- 2. edit_decisions — deny UPDATE from authenticated / anon
-- =============================================================================
DROP POLICY IF EXISTS edit_decisions_update_own ON edit_decisions;

CREATE POLICY edit_decisions_no_update ON edit_decisions
    FOR UPDATE TO authenticated, anon
    USING (false)
    WITH CHECK (false);

-- =============================================================================
-- 3. edit_decisions — deny DELETE from authenticated / anon
--    (defense-in-depth; prevents removal of audit trail)
-- =============================================================================
DROP POLICY IF EXISTS edit_decisions_delete_own ON edit_decisions;

CREATE POLICY edit_decisions_no_delete ON edit_decisions
    FOR DELETE TO authenticated, anon
    USING (false);

-- =============================================================================
-- 4. job_queue — deny INSERT from authenticated / anon
-- =============================================================================
DROP POLICY IF EXISTS job_queue_insert_own ON job_queue;

CREATE POLICY job_queue_no_insert ON job_queue
    FOR INSERT TO authenticated, anon
    WITH CHECK (false);

-- =============================================================================
-- 5. job_queue — deny UPDATE from authenticated / anon
-- =============================================================================
CREATE POLICY job_queue_no_update ON job_queue
    FOR UPDATE TO authenticated, anon
    USING (false)
    WITH CHECK (false);
