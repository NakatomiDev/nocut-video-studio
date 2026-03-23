-- Security fix: Block direct client INSERT/UPDATE on exports table.
--
-- The exports_insert_own and exports_update_own RLS policies allow any
-- project-owner to INSERT or UPDATE export rows, enabling tampering with
-- server-only fields: watermarked, c2pa_signed, and download_url.
--
-- The server-side exporter service uses service_role and bypasses RLS,
-- so removing these policies has zero impact on legitimate functionality.
-- All client-side code (ExportComplete, ExportProgress, ProjectCard)
-- only performs SELECT on exports.

-- =============================================================================
-- 1. exports — deny INSERT from authenticated / anon
-- =============================================================================
DROP POLICY IF EXISTS exports_insert_own ON exports;

CREATE POLICY exports_no_insert ON exports
    FOR INSERT TO authenticated, anon
    WITH CHECK (false);

-- =============================================================================
-- 2. exports — deny UPDATE from authenticated / anon
-- =============================================================================
DROP POLICY IF EXISTS exports_update_own ON exports;

CREATE POLICY exports_no_update ON exports
    FOR UPDATE TO authenticated, anon
    USING (false)
    WITH CHECK (false);
