-- Fix: Drop the duplicate permissive INSERT policy on job_queue that was
-- missed in 20260323030000_lock_edit_decisions_job_queue.sql, which allowed
-- authenticated users to bypass the job_queue_no_insert deny policy.

DROP POLICY IF EXISTS "Users can insert their own jobs" ON job_queue;
