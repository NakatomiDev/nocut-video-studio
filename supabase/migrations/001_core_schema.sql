-- NoCut Core Schema
-- Migration: 001_core_schema
-- Description: Creates core tables for the NoCut video editing platform.
-- NOTE: Credit tables and RLS policies are handled in separate migrations.

-- =============================================================================
-- 1. users
-- =============================================================================
CREATE TABLE users (
    id          UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
    email       TEXT NOT NULL,
    supabase_uid UUID NOT NULL UNIQUE,
    revenuecat_id TEXT,
    tier        TEXT NOT NULL DEFAULT 'free'
                CHECK (tier IN ('free', 'pro', 'business')),
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- 2. projects
-- =============================================================================
CREATE TABLE projects (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    title         TEXT NOT NULL DEFAULT 'Untitled Project',
    status        TEXT NOT NULL DEFAULT 'uploading'
                  CHECK (status IN ('uploading', 'transcoding', 'detecting',
                                    'ready', 'generating', 'exporting',
                                    'complete', 'failed')),
    error_message TEXT,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_projects_user_id ON projects (user_id);
CREATE INDEX idx_projects_status  ON projects (status);

-- =============================================================================
-- 3. videos
-- =============================================================================
CREATE TABLE videos (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id              UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    s3_key                  TEXT NOT NULL,
    duration                FLOAT,
    resolution              TEXT,
    format                  TEXT,
    file_size_bytes         BIGINT,
    proxy_s3_key            TEXT,
    waveform_s3_key         TEXT,
    thumbnail_sprite_s3_key TEXT,
    created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_videos_project_id ON videos (project_id);

-- =============================================================================
-- 4. cut_maps
-- =============================================================================
CREATE TABLE cut_maps (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id        UUID REFERENCES videos(id) ON DELETE CASCADE NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    cuts_json       JSONB NOT NULL DEFAULT '[]',
    transcript_json JSONB,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cut_maps_video_id ON cut_maps (video_id);

-- =============================================================================
-- 5. edit_decisions
-- =============================================================================
CREATE TABLE edit_decisions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id            UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    edl_json              JSONB NOT NULL,
    total_fill_seconds    FLOAT NOT NULL DEFAULT 0,
    credits_charged       INTEGER NOT NULL DEFAULT 0,
    status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'generating', 'exporting',
                                            'complete', 'failed')),
    credit_transaction_id UUID,
    created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_edit_decisions_project_id ON edit_decisions (project_id);
CREATE INDEX idx_edit_decisions_status     ON edit_decisions (status);

-- =============================================================================
-- 6. ai_fills
-- =============================================================================
CREATE TABLE ai_fills (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    edit_decision_id  UUID REFERENCES edit_decisions(id) ON DELETE CASCADE NOT NULL,
    gap_index         INTEGER NOT NULL,
    s3_key            TEXT,
    method            TEXT NOT NULL
                      CHECK (method IN ('ai_fill', 'crossfade', 'hard_cut')),
    provider          TEXT CHECK (provider IN ('did', 'heygen', 'veo', 'custom', 'mock')),
    quality_score     FLOAT,
    duration          FLOAT,
    generation_time_ms INTEGER,
    created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ai_fills_edit_decision_id ON ai_fills (edit_decision_id);

-- =============================================================================
-- 7. exports
-- =============================================================================
CREATE TABLE exports (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    edit_decision_id  UUID REFERENCES edit_decisions(id),
    s3_key            TEXT NOT NULL,
    format            TEXT NOT NULL DEFAULT 'mp4',
    resolution        TEXT,
    duration          FLOAT,
    file_size_bytes   BIGINT,
    watermarked       BOOLEAN NOT NULL DEFAULT true,
    c2pa_signed       BOOLEAN NOT NULL DEFAULT false,
    fill_summary_json JSONB,
    download_url      TEXT,
    created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_exports_project_id ON exports (project_id);

-- =============================================================================
-- 8. speaker_models
-- =============================================================================
CREATE TABLE speaker_models (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    video_id         UUID REFERENCES videos(id) ON DELETE CASCADE,
    embedding_s3_key TEXT NOT NULL,
    created_at       TIMESTAMPTZ DEFAULT now(),
    expires_at       TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_speaker_models_user_id    ON speaker_models (user_id);
CREATE INDEX idx_speaker_models_expires_at ON speaker_models (expires_at);

-- =============================================================================
-- 9. audit_log
-- =============================================================================
CREATE TABLE audit_log (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id) NOT NULL,
    action        TEXT NOT NULL,
    input_hash    TEXT,
    output_hash   TEXT,
    provider      TEXT,
    quality_score FLOAT,
    metadata      JSONB,
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_log_user_id    ON audit_log (user_id);
CREATE INDEX idx_audit_log_created_at ON audit_log (created_at);
