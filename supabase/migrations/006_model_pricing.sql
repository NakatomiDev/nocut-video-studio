-- NoCut Model-Based Pricing
-- Migration: 006_model_pricing
-- Description: Adds model column to ai_fills and edit_decisions for model-aware credit pricing.

-- =============================================================================
-- 1. Add model column to ai_fills
-- =============================================================================
ALTER TABLE ai_fills
    ADD COLUMN model TEXT;

COMMENT ON COLUMN ai_fills.model IS 'AI model used for generation (e.g. veo3.1-fast, veo2, veo3.1-standard-audio)';

-- =============================================================================
-- 2. Add model and credits_per_sec to edit_decisions
-- =============================================================================
ALTER TABLE edit_decisions
    ADD COLUMN model TEXT DEFAULT 'veo3.1-fast',
    ADD COLUMN credits_per_sec INTEGER DEFAULT 1;

COMMENT ON COLUMN edit_decisions.model IS 'AI fill model selected for this edit decision';
COMMENT ON COLUMN edit_decisions.credits_per_sec IS 'Credit cost per second of fill at time of creation';

-- =============================================================================
-- 3. Update provider CHECK constraint on ai_fills to include new providers
-- =============================================================================
ALTER TABLE ai_fills
    DROP CONSTRAINT IF EXISTS ai_fills_provider_check;

ALTER TABLE ai_fills
    ADD CONSTRAINT ai_fills_provider_check
    CHECK (provider IN ('did', 'heygen', 'veo', 'veo2', 'veo3', 'veo3.1', 'custom', 'mock'));

-- =============================================================================
-- 4. Backfill existing rows
-- =============================================================================
UPDATE ai_fills SET model = 'veo2' WHERE provider = 'veo' AND model IS NULL;
UPDATE ai_fills SET model = 'mock' WHERE provider = 'mock' AND model IS NULL;
UPDATE edit_decisions SET model = 'veo2', credits_per_sec = 1 WHERE model = 'veo3.1-fast' AND credits_charged > 0;
