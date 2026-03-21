-- NoCut Job Queue
-- Migration: 004_job_queue
-- Description: Creates job_queue table for async processing,
--              enables RLS, and activates Supabase Realtime.

-- =============================================================================
-- 1. job_queue table
-- =============================================================================
CREATE TABLE job_queue (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id          UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    type             TEXT NOT NULL CHECK (type IN ('video.transcode', 'video.detect', 'ai.fill', 'video.export')),
    payload          JSONB NOT NULL DEFAULT '{}',
    status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'complete', 'failed', 'dead_letter')),
    priority         INTEGER NOT NULL DEFAULT 10,
    progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
    attempts         INTEGER NOT NULL DEFAULT 0,
    max_attempts     INTEGER NOT NULL DEFAULT 3,
    error_message    TEXT,
    started_at       TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- 2. Indexes
-- =============================================================================
CREATE INDEX idx_job_queue_poll       ON job_queue (status, priority, created_at);
CREATE INDEX idx_job_queue_project_id ON job_queue (project_id);
CREATE INDEX idx_job_queue_user_id    ON job_queue (user_id);

-- =============================================================================
-- 3. Row Level Security — SELECT own jobs only
-- =============================================================================
ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_queue_select_own ON job_queue
    FOR SELECT USING (auth.uid() = user_id);

-- =============================================================================
-- 4. Supabase Realtime
-- =============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE job_queue;
ALTER PUBLICATION supabase_realtime ADD TABLE projects;
ALTER PUBLICATION supabase_realtime ADD TABLE credit_transactions;
