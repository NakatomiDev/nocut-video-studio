-- NoCut Row Level Security Policies
-- Migration: 003_rls_policies
-- Description: Enables RLS on all tables, creates ownership policies,
--              and adds the handle_new_user trigger for auth.users signup.

-- =============================================================================
-- 1. Enable Row Level Security on ALL tables
-- =============================================================================
ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects           ENABLE ROW LEVEL SECURITY;
ALTER TABLE videos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE cut_maps           ENABLE ROW LEVEL SECURITY;
ALTER TABLE edit_decisions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_fills           ENABLE ROW LEVEL SECURITY;
ALTER TABLE exports            ENABLE ROW LEVEL SECURITY;
ALTER TABLE speaker_models     ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger      ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 2. users — SELECT and UPDATE own row only (INSERT via trigger)
-- =============================================================================
CREATE POLICY users_select_own ON users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY users_update_own ON users
    FOR UPDATE USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- =============================================================================
-- 3. projects — full CRUD, direct user_id ownership
-- =============================================================================
CREATE POLICY projects_select_own ON projects
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY projects_insert_own ON projects
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY projects_update_own ON projects
    FOR UPDATE USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY projects_delete_own ON projects
    FOR DELETE USING (auth.uid() = user_id);

-- =============================================================================
-- 4. videos — CRUD via project ownership
-- =============================================================================
CREATE POLICY videos_select_own ON videos
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = videos.project_id
              AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY videos_insert_own ON videos
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = videos.project_id
              AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY videos_update_own ON videos
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = videos.project_id
              AND projects.user_id = auth.uid()
        )
    ) WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = videos.project_id
              AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY videos_delete_own ON videos
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = videos.project_id
              AND projects.user_id = auth.uid()
        )
    );

-- =============================================================================
-- 5. cut_maps — CRUD via video → project ownership
-- =============================================================================
CREATE POLICY cut_maps_select_own ON cut_maps
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM videos
            JOIN projects ON projects.id = videos.project_id
            WHERE videos.id = cut_maps.video_id
              AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY cut_maps_insert_own ON cut_maps
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM videos
            JOIN projects ON projects.id = videos.project_id
            WHERE videos.id = cut_maps.video_id
              AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY cut_maps_update_own ON cut_maps
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM videos
            JOIN projects ON projects.id = videos.project_id
            WHERE videos.id = cut_maps.video_id
              AND projects.user_id = auth.uid()
        )
    ) WITH CHECK (
        EXISTS (
            SELECT 1 FROM videos
            JOIN projects ON projects.id = videos.project_id
            WHERE videos.id = cut_maps.video_id
              AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY cut_maps_delete_own ON cut_maps
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM videos
            JOIN projects ON projects.id = videos.project_id
            WHERE videos.id = cut_maps.video_id
              AND projects.user_id = auth.uid()
        )
    );

-- =============================================================================
-- 6. edit_decisions — CRUD via project ownership
-- =============================================================================
CREATE POLICY edit_decisions_select_own ON edit_decisions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = edit_decisions.project_id
              AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY edit_decisions_insert_own ON edit_decisions
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = edit_decisions.project_id
              AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY edit_decisions_update_own ON edit_decisions
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = edit_decisions.project_id
              AND projects.user_id = auth.uid()
        )
    ) WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = edit_decisions.project_id
              AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY edit_decisions_delete_own ON edit_decisions
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = edit_decisions.project_id
              AND projects.user_id = auth.uid()
        )
    );

-- =============================================================================
-- 7. ai_fills — CRUD via edit_decision → project ownership
-- =============================================================================
CREATE POLICY ai_fills_select_own ON ai_fills
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM edit_decisions
            JOIN projects ON projects.id = edit_decisions.project_id
            WHERE edit_decisions.id = ai_fills.edit_decision_id
              AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY ai_fills_insert_own ON ai_fills
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM edit_decisions
            JOIN projects ON projects.id = edit_decisions.project_id
            WHERE edit_decisions.id = ai_fills.edit_decision_id
              AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY ai_fills_update_own ON ai_fills
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM edit_decisions
            JOIN projects ON projects.id = edit_decisions.project_id
            WHERE edit_decisions.id = ai_fills.edit_decision_id
              AND projects.user_id = auth.uid()
        )
    ) WITH CHECK (
        EXISTS (
            SELECT 1 FROM edit_decisions
            JOIN projects ON projects.id = edit_decisions.project_id
            WHERE edit_decisions.id = ai_fills.edit_decision_id
              AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY ai_fills_delete_own ON ai_fills
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM edit_decisions
            JOIN projects ON projects.id = edit_decisions.project_id
            WHERE edit_decisions.id = ai_fills.edit_decision_id
              AND projects.user_id = auth.uid()
        )
    );

-- =============================================================================
-- 8. exports — CRUD via project ownership
-- =============================================================================
CREATE POLICY exports_select_own ON exports
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = exports.project_id
              AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY exports_insert_own ON exports
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = exports.project_id
              AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY exports_update_own ON exports
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = exports.project_id
              AND projects.user_id = auth.uid()
        )
    ) WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = exports.project_id
              AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY exports_delete_own ON exports
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = exports.project_id
              AND projects.user_id = auth.uid()
        )
    );

-- =============================================================================
-- 9. speaker_models — full CRUD, direct user_id ownership
-- =============================================================================
CREATE POLICY speaker_models_select_own ON speaker_models
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY speaker_models_insert_own ON speaker_models
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY speaker_models_update_own ON speaker_models
    FOR UPDATE USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY speaker_models_delete_own ON speaker_models
    FOR DELETE USING (auth.uid() = user_id);

-- =============================================================================
-- 10. audit_log — SELECT own rows only (service role writes)
-- =============================================================================
CREATE POLICY audit_log_select_own ON audit_log
    FOR SELECT USING (auth.uid() = user_id);

-- =============================================================================
-- 11. credit_ledger — SELECT own rows only (service role manages)
-- =============================================================================
CREATE POLICY credit_ledger_select_own ON credit_ledger
    FOR SELECT USING (auth.uid() = user_id);

-- =============================================================================
-- 12. credit_transactions — SELECT own rows only (service role manages)
-- =============================================================================
CREATE POLICY credit_transactions_select_own ON credit_transactions
    FOR SELECT USING (auth.uid() = user_id);

-- =============================================================================
-- 13. handle_new_user trigger function (SECURITY DEFINER)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, supabase_uid, tier)
  VALUES (NEW.id, NEW.email, NEW.id, 'free');

  -- Allocate free tier monthly credits (5 credits, expire in 2 months)
  INSERT INTO public.credit_ledger (user_id, type, credits_granted, credits_remaining, expires_at)
  VALUES (NEW.id, 'monthly_allowance', 5, 5, now() + interval '2 months');

  -- Log the allocation
  INSERT INTO public.credit_transactions (user_id, type, credits, reason)
  VALUES (NEW.id, 'allocation', 5, 'free_tier_signup');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 14. Trigger on auth.users signup
-- =============================================================================
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
