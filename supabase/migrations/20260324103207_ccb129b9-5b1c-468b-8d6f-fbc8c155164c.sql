-- Add soft-delete column to projects
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

-- Update SELECT RLS to only show non-deleted projects by default
DROP POLICY IF EXISTS "projects_select_own" ON public.projects;
CREATE POLICY "projects_select_own" ON public.projects
  FOR SELECT TO public
  USING (auth.uid() = user_id AND deleted_at IS NULL);

-- Replace DELETE policy with soft-delete (block hard deletes from client)
DROP POLICY IF EXISTS "projects_delete_own" ON public.projects;
CREATE POLICY "projects_delete_own" ON public.projects
  FOR DELETE TO public
  USING (false);

-- Allow users to soft-delete their own projects (set deleted_at)
DROP POLICY IF EXISTS "projects_update_own" ON public.projects;
CREATE POLICY "projects_update_own" ON public.projects
  FOR UPDATE TO public
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add index for efficient filtering of active projects
CREATE INDEX IF NOT EXISTS idx_projects_active ON public.projects (user_id) WHERE deleted_at IS NULL;

-- Add index for audit queries on deleted projects
CREATE INDEX IF NOT EXISTS idx_projects_deleted ON public.projects (user_id, deleted_at) WHERE deleted_at IS NOT NULL;