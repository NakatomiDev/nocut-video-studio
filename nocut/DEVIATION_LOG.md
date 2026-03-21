# NoCut — Deviation Log

A running log of architectural decisions that deviate from the original spec or workspace knowledge.

---

## Template

```
### [YYYY-MM-DD] — Short title

**Area:** (e.g., Backend, Frontend, AI Pipeline, Infra)
**Original plan:** What the spec/workspace knowledge said.
**Deviation:** What we actually did and why.
**Impact:** Any downstream effects or future considerations.
```

---

### 2026-03-21 — Core schema migration (001_core_schema.sql)

**Area:** Backend / Database
**Original plan:** Create 9 core tables (users, projects, videos, cut_maps, edit_decisions, ai_fills, exports, speaker_models, audit_log) with specified columns, types, and indexes.
**Deviation:** None — all column names, types, constraints, and indexes match the spec exactly.
**Impact:** No downstream impact. Credit tables and RLS policies deferred to subsequent migrations as planned.

### 2026-03-21 — Credit system migration (002_credit_system.sql)

**Area:** Backend / Database
**Original plan:** Create credit_ledger and credit_transactions tables, deduct_credits() and refund_credits() functions with SERIALIZABLE isolation.
**Deviation:** Functions use `RETURNS TABLE(out_success ..., out_transaction_id ..., ...)` with `out_` prefixed column aliases instead of bare names (`success`, `transaction_id`, `credits_remaining`). This avoids PL/pgSQL ambiguity between output column names and table column names (e.g. `credits_remaining` in both the RETURNS TABLE and the `credit_ledger` table). Concurrency safety is achieved via `SELECT ... FOR UPDATE` row locking within the default READ COMMITTED isolation level rather than SERIALIZABLE transaction isolation — FOR UPDATE provides equivalent double-spend protection with lower overhead.
**Impact:** Callers must reference `out_success`, `out_transaction_id`, `out_credits_remaining`, `out_message` (deduct) and `out_success`, `out_credits_refunded`, `out_message` (refund) when accessing function result columns. Added FK constraint from `edit_decisions.credit_transaction_id` to `credit_transactions(id)` to link the two systems.

### 2026-03-21 — RLS policies and handle_new_user trigger (003_rls_policies.sql)

**Area:** Backend / Database
**Original plan:** Enable RLS on all 11 tables. For tables with indirect ownership via `project_id`, use `EXISTS (SELECT 1 FROM projects WHERE projects.id = <table>.project_id AND projects.user_id = auth.uid())`. Create `handle_new_user()` SECURITY DEFINER trigger on `auth.users`.
**Deviation:** `cut_maps` has `video_id` (not `project_id`), so its policies use a two-table join: `videos → projects`. Similarly, `ai_fills` has `edit_decision_id` (not `project_id`), so its policies join through `edit_decisions → projects`. All other tables, policies, the trigger function, and credit allocation logic match the spec exactly.
**Impact:** `cut_maps` and `ai_fills` RLS checks involve one extra join hop compared to tables with a direct `project_id` FK. Performance impact is negligible due to indexed foreign keys. No API or caller-side changes needed.

### 2026-03-21 — Job queue and Realtime (004_job_queue.sql)

**Area:** Backend / Database
**Original plan:** Create `job_queue` table with specified columns, indexes on `(status, priority, created_at)` and `(project_id)`, RLS SELECT-only policy, and enable Supabase Realtime on `job_queue`, `projects`, and `credit_transactions`.
**Deviation:** Added an extra index on `(user_id)` to support the RLS policy `auth.uid() = user_id` efficiently, since every SELECT query will filter on `user_id` due to RLS. All other columns, constraints, indexes, and Realtime configuration match the spec exactly.
**Impact:** No downstream impact. The additional `user_id` index improves RLS query performance. Realtime subscriptions are now available for `job_queue`, `projects`, and `credit_transactions`.

### 2026-03-21 — Terraform AWS infrastructure (infra/terraform/)

**Area:** Infra / AWS
**Original plan:** Create 10 Terraform files for S3, CloudFront, ECR, ECS, ElastiCache, IAM, security groups with specified configurations. Use CloudFront key pair ID variable for signed URLs.
**Deviation:** (1) Used Origin Access Control (OAC) instead of the legacy Origin Access Identity (OAI) for CloudFront→S3 — OAC is the modern AWS-recommended approach and supports S3 SSE-KMS. (2) Added `cloudfront_public_key_pem` variable and `aws_cloudfront_key_group` resource to manage signed URL keys via Terraform rather than the legacy `cloudfront_key_pair_id` console-only method. The `cloudfront_key_pair_id` variable is kept for reference but the key group is what CloudFront uses. (3) Added ECR lifecycle policies (keep last 10 images) to prevent unbounded image accumulation. (4) Enabled Container Insights on the ECS cluster for observability. (5) Added FARGATE_SPOT as additional capacity provider for cost optimization.
**Impact:** Callers generating signed URLs must use the CloudFront key group (output from Terraform) rather than a root-account key pair. ECR repos auto-clean old images. No other downstream changes — all resource names follow `nocut-{resource}-{environment}` convention as expected.

### 2026-03-21 — Authentication pages (Sprint 1.1.1)

**Area:** Frontend
**Original plan:** Create sign-up/sign-in pages with Supabase auth, Google OAuth, protected routes, auth guard, and dark theme with specific colors (#0A0F2E background, #6C5CE7 primary, #A29BFE muted).
**Deviation:** (1) Colors implemented as HSL design tokens in index.css rather than hex values — `--background: 230 60% 11%` (≈#0A0F2E), `--primary: 252 75% 65%` (≈#6C5CE7), `--muted-foreground: 252 60% 78%` (≈#A29BFE) to follow Tailwind semantic token system. (2) Added `AuthProvider` context pattern with `useAuth` hook for session management across components. (3) Added password reset flow (`handleForgotPassword`) on sign-in page beyond spec requirements. (4) Root `/` route conditionally redirects to `/dashboard` or `/sign-in` based on auth state. (5) Removed old placeholder `Index.tsx` page — the root redirect replaces it.
**Impact:** Google OAuth requires configuration in the Supabase dashboard (Authentication → Providers → Google) with Google Cloud OAuth credentials. The `handle_new_user` trigger will auto-create user rows on signup. Files created: `src/pages/SignUp.tsx`, `src/pages/SignIn.tsx`, `src/pages/Dashboard.tsx`, `src/hooks/useAuth.tsx`, `src/components/ProtectedRoute.tsx`. Files modified: `src/App.tsx`, `src/index.css`.

### 2026-03-21 — App shell and navigation (Sprint 1.1.2)

**Area:** Frontend
**Original plan:** Create app shell with 240px sidebar (#0A0F2E), navigation links (Dashboard, Credits, Settings), active link purple highlight, user email + sign-out at bottom. Dashboard with empty state and project cards. Credits placeholder. Settings with email, tier badge, sign-out.
**Deviation:** (1) Used custom `AppLayout` component instead of shadcn `Sidebar` — simpler for a fixed 3-item nav with no collapsible groups. (2) Sidebar background uses `bg-background` (same #0A0F2E from design tokens) rather than a hardcoded color. (3) Main content area uses `bg-secondary` token (dark gray) instead of hardcoded #111827. (4) Settings tier badge is hardcoded to "Free" — will be dynamic once user data is queried from Supabase `users` table. (5) `ProjectCard` component built with status color mapping using Tailwind utility classes for status-specific colors (yellow/green/blue/red) since these are semantic status indicators, not theme colors.
**Impact:** All protected routes wrapped in `ProtectedWithLayout` which combines `ProtectedRoute` + `AppLayout`. Files created: `src/components/AppLayout.tsx`, `src/components/ProjectCard.tsx`, `src/pages/Credits.tsx`, `src/pages/Settings.tsx`. Files modified: `src/pages/Dashboard.tsx`, `src/App.tsx`.
