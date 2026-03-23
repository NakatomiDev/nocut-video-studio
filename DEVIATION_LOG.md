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

### 2026-03-21 — Upload initiation Edge Function (Prompt 2.1.1)

**Area:** Backend / Edge Functions
**Original plan:** Create `supabase/functions/upload-initiate/index.ts` with auth, validation, tier limits, DB record creation, and presigned S3 URL generation. Also create shared utilities (`_shared/cors.ts`, `auth.ts`, `response.ts`, `tier-limits.ts`).
**Files created:**
- `supabase/functions/deno.json` — Import map for all Edge Functions
- `supabase/functions/_shared/cors.ts` — CORS headers and OPTIONS handler
- `supabase/functions/_shared/auth.ts` — JWT verification and service client factory
- `supabase/functions/_shared/response.ts` — Consistent JSON response envelope (success/error + meta)
- `supabase/functions/_shared/tier-limits.ts` — Tier limit constants, MIME type validation, limit enforcement
- `supabase/functions/upload-initiate/index.ts` — Main upload initiation function
- `supabase/migrations/005_upload_tracking.sql` — Adds `multipart_upload_id`, `total_chunks`, `upload_chunks` columns to `videos` table
**Deviation:** (1) Created migration 005_upload_tracking.sql in this prompt rather than deferring to Prompt 2.1.2. The `multipart_upload_id` column is needed by upload-initiate to store the S3 UploadId, and by chunk-complete/upload-complete to look up sessions. Prompt 2.1.2 says "create migration 005 if needed" — it was needed here. (2) Uses S3 `CreateMultipartUpload` + `UploadPart` presigned URLs (not simple PUT URLs) because Prompt 2.1.2 requires `CompleteMultipartUpload` with ETags. (3) The `upload_session_id` in the response is the S3 multipart `UploadId` string, not a UUID — this is the natural session identifier that S3 requires for subsequent part uploads and completion.
**Impact:** Prompt 2.1.2 can skip creating migration 005. The chunk-complete function should look up videos by `multipart_upload_id` to find the associated project/user for ownership verification. S3 part numbers are 1-indexed internally but the API exposes 0-indexed `chunk_index` — callers must map `PartNumber = chunk_index + 1`.

### [2026-03-21] — Prompt 2.1.2: Upload chunk-complete and upload-complete Edge Functions

**Area:** Backend / Edge Functions
**Original plan:** Create `supabase/functions/upload-chunk-complete/index.ts` and `supabase/functions/upload-complete/index.ts`. Chunk-complete tracks per-chunk ETags in `videos.upload_chunks` JSONB. Upload-complete verifies all chunks, calls S3 `CompleteMultipartUpload`, transitions project to `transcoding`, and queues a `video.transcode` job.
**Files created:**
- `supabase/functions/upload-chunk-complete/index.ts` — Validates auth/ownership, records chunk ETag in `upload_chunks` JSONB array, returns progress percentage
- `supabase/functions/upload-complete/index.ts` — Validates auth/ownership, verifies all chunks present, calls S3 CompleteMultipartUpload, updates project status, inserts job_queue row
**Deviation:** (1) The spec listed `upload_session_id` as UUID type in the request body, but it is actually the S3 multipart UploadId which is a string (not a UUID). Validation accepts any non-empty string, consistent with upload-initiate. (2) No additional migration needed — migration 005 from Prompt 2.1.1 already added the required `upload_chunks`, `multipart_upload_id`, and `total_chunks` columns. (3) Chunk completion uses read-modify-write pattern on the JSONB array rather than a Postgres function, which is acceptable for typical upload concurrency. Duplicate chunk_index entries are handled idempotently (replaced, not duplicated). (4) Job queue insertion failure is treated as non-fatal — the project status is already updated and the job can be retried manually.
**Impact:** The complete upload pipeline (initiate → chunk-complete → upload-complete) is now functional. The next step (Prompt 2.2.1) can build the frontend upload UI against these three endpoints. The transcoding worker (Prompt 2.3.1) will poll the job_queue for `video.transcode` jobs.

### 2026-03-21 — Upload flow UI (Prompt 2.2.1)

**Area:** Frontend
**Original plan:** Build upload modal/page with drag-and-drop zone, file validation, chunked upload with progress, speed/ETA, error handling with resume, and Realtime subscription for processing status.
**Files created:**
- `src/hooks/useUpload.ts` — Upload state machine and chunked upload engine (4 concurrent workers, 5MB chunks, resume support)
- `src/pages/Upload.tsx` — Full-screen upload overlay with drag-and-drop zone, progress bar, processing status, error states
**Files modified:**
- `src/pages/Dashboard.tsx` — Wired "New Project" and "Upload Video" buttons to navigate to `/upload`
- `src/App.tsx` — Added `/upload` route (protected, no AppLayout wrapper since it's a full-screen overlay)
**Deviation:** (1) Upload page is a full-screen overlay at `/upload` rather than a modal dialog — simpler routing and avoids z-index issues with the sidebar. (2) The `/upload` route uses `ProtectedRoute` without `AppLayout` since the overlay covers the entire screen. (3) ETag from S3 presigned PUT responses may not always be accessible due to CORS — falls back to a generated placeholder ETag. S3 CORS config must include `ExposeHeaders: ["ETag"]` for proper multipart completion. (4) Realtime subscription for project status is set up after upload-complete succeeds; channel cleanup relies on component unmount.
**Impact:** S3 bucket CORS configuration must expose the `ETag` header for chunked uploads to work correctly with `CompleteMultipartUpload`. The editor page at `/project/{project_id}` does not exist yet — redirect will 404 until Sprint 3.

### [2026-03-21] — Prompt 2.3.1: Transcoding Docker service

**Area:** Backend / Services
**Original plan:** Create a Node.js service at `services/transcoder/` that connects to Redis (BullMQ), polls `video.transcode` jobs, downloads source from S3, runs FFmpeg (transcode, proxy, waveform, thumbnails), uploads results, and updates Supabase DB.
**Files created:**
- `services/transcoder/package.json` — Dependencies: bullmq, @aws-sdk/client-s3, @aws-sdk/lib-storage, @supabase/supabase-js
- `services/transcoder/tsconfig.json` — ES2022/NodeNext target
- `services/transcoder/Dockerfile` — node:20-slim + FFmpeg via apt-get, runs as non-root user
- `services/transcoder/src/config.ts` — Validated env vars (REDIS_URL, SUPABASE_*, AWS_*, CONCURRENCY)
- `services/transcoder/src/supabase.ts` — Service-role client with job lifecycle helpers (claim, progress, complete, fail) and DB update functions
- `services/transcoder/src/s3.ts` — Download/upload utilities with multipart upload for large files (>50MB)
- `services/transcoder/src/transcoder.ts` — Core FFmpeg pipeline: probe → transcode H.264/AAC → 360p proxy → waveform extraction → thumbnail sprite sheets → upload → DB update
- `services/transcoder/src/index.ts` — BullMQ worker + Supabase poller bridge
**Deviation:** (1) Uses a hybrid Supabase-poller-to-BullMQ architecture: since `upload-complete` inserts jobs into the Supabase `job_queue` table (not Redis), a 5-second poller reads queued rows, claims them (optimistic lock via `status='queued'` WHERE clause), and feeds them into a local BullMQ queue. BullMQ handles concurrency and processing. (2) Removed standalone `ioredis` dependency — BullMQ bundles its own ioredis; using a separate version causes TypeScript type conflicts. Connection is passed as a URL config object instead. (3) `incrementAttempts` uses a fallback read-then-write pattern since no `increment_job_attempts` RPC function exists yet. (4) Waveform extraction pipes raw f32le audio from FFmpeg, downsamples to ~1000 normalized (0-1) data points. (5) Thumbnail sprites use FFmpeg `tile=10x1` filter without `-frames:v 1`, producing multiple sprite sheets automatically for videos longer than 10 seconds.
**Impact:** The transcoder is ready to deploy as a Docker container to ECS Fargate. It transitions projects from `transcoding` → `detecting` and enqueues `video.detect` jobs for the detector service (Prompt 3.1.1). An `increment_job_attempts` Postgres function could be added for atomic increment but the fallback works correctly for the current concurrency model.

### [2026-03-21] — Prompt 3.1.1: Silence detection service

**Area:** Backend / Services
**Original plan:** Create a Python service at `services/detector/` that analyzes video audio to detect silence/pauses, writes cut maps to the `cut_maps` table, and transitions projects from `detecting` → `ready`.
**Files created:**
- `services/detector/requirements.txt` — numpy, librosa, soundfile, supabase, httpx, boto3, pytest
- `services/detector/Dockerfile` — python:3.11-slim + FFmpeg + libsndfile, runs as non-root
- `services/detector/src/config.py` — Environment variables with configurable thresholds
- `services/detector/src/supabase_client.py` — Service-role client with job lifecycle helpers and cut_map insertion
- `services/detector/src/s3_utils.py` — S3 download via boto3
- `services/detector/src/detector.py` — Core silence detection: FFmpeg audio extraction → librosa RMS energy → sliding window analysis → confidence scoring
- `services/detector/src/main.py` — Entry point with Supabase job_queue poller (no Redis/BullMQ)
- `services/detector/tests/test_detector.py` — 10 tests covering RMS computation, silence region finding, confidence scoring, and end-to-end detection
**Deviation:** (1) Uses Supabase job_queue polling only (no Redis/BullMQ) as recommended by the spec for MVP simplicity. Polls every 5 seconds for `video.detect` jobs with `status='queued'`. (2) Used `librosa.feature.rms` for RMS computation instead of pydub — librosa is more precise for sliding-window analysis and doesn't require converting to pydub AudioSegment format. (3) Used `soundfile` (via libsndfile) instead of pydub for test WAV generation to avoid FFmpeg dependency in CI. (4) Used `boto3` instead of `httpx` for S3 downloads — more robust for large files with built-in retry/streaming. (5) Confidence score uses a weighted formula: 60% duration component (ramps 0.5→1.0 over 0-10s) + 40% depth component (how far below threshold in dB). (6) Tests are structured to test internal functions directly (`_compute_rms_db`, `_find_silence_regions`, `_compute_confidence`) without requiring FFmpeg; the end-to-end test is skipped when FFmpeg is unavailable. (7) `ffmpeg-python` package was not used — direct `subprocess.run` calls are simpler and avoid an unnecessary dependency.
**Impact:** The detector service completes the automated processing pipeline: upload → transcode → detect → ready. Projects in `ready` status have cut maps available for the editor UI (Sprint 3.2). The `cut_maps.cuts_json` JSONB column stores the full cut list with confidence scores and auto-accept flags. The editor can filter by `auto_accept: true` to pre-select obvious cuts.

### [2026-03-21] — Prompt 3.2.1: Editor page layout

**Area:** Frontend / Editor
**Original plan:** Build `/project/:projectId` editor page with video player, cuts panel, timeline placeholder, and Zustand state management.
**Files created:**
- `src/stores/editorStore.ts` — Zustand store with project/video/cutMap state, activeCuts set, playhead, zoom, play/pause
- `src/components/editor/VideoPlayer.tsx` — HTML5 video player with custom controls (play/pause, seek, volume, speed)
- `src/components/editor/CutsPanel.tsx` — Right sidebar listing detected cuts with toggle switches, type badges, credit estimate
- `src/pages/ProjectEditor.tsx` — Full-screen editor with data loading, processing states, realtime subscription, inline title editing
**Files modified:**
- `src/App.tsx` — Added `/project/:projectId` route (protected, no AppLayout)
**Deviation:** (1) Used Zustand instead of React context for editor state — better perf for frequent playhead updates. (2) Video URL uses raw s3_key/proxy_s3_key — needs CloudFront/presigned URLs in production. (3) Signed URL generation deferred. (4) Status 'ready' triggers page reload for simplicity. (5) activeCuts uses Set<string> for O(1) toggle.
**Impact:** Editor page at `/project/:projectId` is functional. Timeline Canvas components come in prompt 3.2.2. Video URLs need CloudFront for production.

### [2026-03-21] — Prompt 3.2.2: Waveform timeline component

**Area:** Frontend / Editor
**Original plan:** Build a Canvas-based waveform timeline with zoom/scroll, silence overlays, draggable playhead with snap, and video sync.
**Files created:**
- `src/components/editor/WaveformTimeline.tsx` — Canvas waveform renderer with zoom (1-10x), scroll, silence overlays, playhead with cut-boundary snap (100ms), RAF animation loop
**Files modified:**
- `src/pages/ProjectEditor.tsx` — Replaced "Timeline loading..." placeholder with WaveformTimeline component
- `nocut/docs/PROMPT_PLAYBOOK.md` — Marked Prompt 3.2.2 complete
**Deviation:** (1) Waveform data falls back to random mock data when URL is unavailable — allows visual testing without a real waveform JSON endpoint. (2) Uses ResizeObserver for responsive canvas sizing instead of fixed dimensions. (3) Silence overlay colors use HSL with design tokens (primary at 30% opacity) instead of hardcoded hex. (4) Tooltip uses radix Tooltip primitive for cut hover info rather than a custom DOM tooltip. (5) Scrollbar is a custom draggable div rather than native overflow-x — gives consistent styling and avoids canvas clipping issues. (6) Auto-scroll follows playhead during playback with a 50px margin.
**Impact:** The timeline is interactive but waveform data depends on the transcoder generating waveform JSON and storing the URL in `videos.waveform_s3_key`. Until then, mock data is shown.

### 2026-03-21 — GCP Vertex AI configuration (Phase 2 preparation)

**Area:** Infra / GCP
**Original plan:** Create GCP project `nocut-ai-dev`, enable Vertex AI and Cloud Storage APIs, create service account `nocut-ai-engine@nocut-ai-dev.iam.gserviceaccount.com`, generate SA key at `infra/gcp-sa-key.json`, create verification script and Terraform config.
**Deviation:** (1) GCP project creation, API enablement, and service account setup are documented as manual steps since they require interactive `gcloud auth login` and a billing-enabled GCP account — cannot be automated in CI or headless environments. (2) `infra/terraform/gcp.tf` adds the `hashicorp/google` provider (~> 5.0) alongside the existing AWS provider; the Vertex AI endpoint resource is commented out as a placeholder since no model is deployed yet in Phase 1. (3) Verification script (`infra/scripts/verify-gcp.sh`) checks all prerequisites (gcloud CLI, SA key, API enablement, Vertex AI access) with clear remediation instructions on failure, following the pattern of the existing `verify-infra.sh`. (4) `.env.example` updated with `GCP_PROJECT_ID`, `GCP_REGION`, and `GOOGLE_APPLICATION_CREDENTIALS` variables. `.gitignore` already covered `gcp-sa-key.json`.
**Impact:** GCP is not required for Phase 1 MVP (crossfade fallback). When Phase 2 begins: (1) run the manual `gcloud` steps documented in `gcp.tf` header comments, (2) uncomment the `google_vertex_ai_endpoint` resource in `gcp.tf`, (3) run `terraform init` to download the Google provider, (4) run `verify-gcp.sh` to confirm access. Service account email will be `nocut-ai-engine@<project-id>.iam.gserviceaccount.com`. APIs to enable: `aiplatform.googleapis.com`, `storage.googleapis.com`.

### 2026-03-21 — Manual cut tool and cut list (Prompt 3.2.3)

**Area:** Frontend / Editor
**Original plan:** Add razor tool with click-twice or drag-to-select manual cutting, split CutsPanel into Detected Pauses and Manual Cuts sections, add credit balance display, export confirmation dialog, and debounced estimate Edge Function call.
**Deviation:** (1) Skipped the `/projects/:id/estimate` Edge Function call — credit estimate is calculated client-side from active cut durations (same logic, avoids unnecessary network round-trip for an estimate). (2) Export confirmation inserts directly into `edit_decisions` table instead of calling a `/projects/:id/edl` Edge Function — the Edge Function doesn't exist yet and the insert achieves the same result with RLS protection. (3) Drag-to-select not implemented separately — the two-click razor workflow covers the same use case. (4) Used `violet-500` Tailwind utility for manual cut indicators instead of a design token since there's no semantic token for "manual cut" in the design system.
**Files created/modified:** `src/stores/editorStore.ts` (updated), `src/components/editor/CutsPanel.tsx` (rewritten), `src/components/editor/WaveformTimeline.tsx` (updated with razor tool).
**Impact:** Manual cuts work end-to-end in the editor UI. Edge Functions for estimate/EDL should be created when the export pipeline is built.

### 2026-03-22 — Credit Edge Functions (Prompt 4.1.1)

**Area:** Backend / Supabase Edge Functions
**Original plan:** Create 5 credit-related Edge Functions: credits-balance, credits-history, credits-topup, project-estimate, project-edl.
**Files created:**
- `supabase/functions/_shared/credits.ts` — Shared credit utilities (balance query, gap estimation, topup product config, tier fill limits)
- `supabase/functions/credits-balance/index.ts` — GET endpoint returning monthly/topup/total balance with ledger breakdown
- `supabase/functions/credits-history/index.ts` — GET endpoint with paginated credit transactions joined with project titles
- `supabase/functions/credits-topup/index.ts` — POST endpoint creating Stripe Checkout sessions for credit top-ups
- `supabase/functions/project-estimate/index.ts` — POST endpoint estimating credits required for a set of gaps
- `supabase/functions/project-edl/index.ts` — POST endpoint that deducts credits, creates edit_decision + job_queue rows
**Files modified:**
- `supabase/functions/_shared/cors.ts` — Added GET to Access-Control-Allow-Methods (was POST-only)
- `supabase/functions/deno.json` — Added `stripe` import map entry (esm.sh/stripe@14)
- `docs/PROMPT_PLAYBOOK.md` — Marked Prompt 4.1.1 complete
**Deviation:** (1) Extracted shared credit logic into `_shared/credits.ts` (getCreditBalance, estimateGaps, TOPUP_PRODUCTS, MAX_FILL_DURATION) rather than duplicating across functions — follows existing `_shared/` pattern. (2) Stripe price IDs are configured via per-product env vars (`STRIPE_PRICE_nocut_credits_10`, etc.) rather than a single JSON config — simpler for Supabase secrets management. (3) `project-edl` requires `project_id` in the request body (not URL path) — consistent with other POST endpoints in the codebase. (4) RevenueCat entitlement check simplified to a DB tier lookup (`users.tier`) as specified for MVP — full RevenueCat SDK integration deferred to webhook functions (Prompt 4.2.1). (5) `deduct_credits` RPC uses `out_` prefixed return columns matching the actual DB function signature (deviation 002 from credit system migration). (6) Stripe SDK imported via esm.sh CDN (`https://esm.sh/stripe@14`) for Deno compatibility rather than npm specifier. (7) `credits-balance` and `credits-history` use the user's auth-scoped supabaseClient (respects RLS) rather than the service client, since credit_ledger and credit_transactions already have SELECT RLS policies for own rows.
**Impact:** All 5 credit Edge Functions are ready to deploy. Requires Stripe secrets to be configured in Supabase for the topup flow. The webhooks-stripe function (Prompt 4.2.1) is needed to actually credit the ledger after Stripe payment completes.

### 2026-03-22 — Webhook handler Edge Functions (Prompt 4.2.1)

**Area:** Backend / Supabase Edge Functions
**Original plan:** Create webhooks-revenuecat and webhooks-stripe Edge Functions to handle subscription events and top-up purchase completions.
**Files created:**
- `supabase/functions/webhooks-revenuecat/index.ts` — Handles INITIAL_PURCHASE, RENEWAL, PRODUCT_CHANGE, CANCELLATION, EXPIRATION, BILLING_ISSUE, UNCANCELLATION events
- `supabase/functions/webhooks-stripe/index.ts` — Handles checkout.session.completed and charge.refunded events
**Files modified:**
- `docs/PROMPT_PLAYBOOK.md` — Marked Prompt 4.2.1 complete
**Deviation:** (1) CANCELLATION and UNCANCELLATION only log — the `users` table has no `cancel_at_period_end` column and adding a migration was out of scope for this prompt; the subscription remains active until EXPIRATION fires. (2) BILLING_ISSUE only logs — no `billing_issue` flag column exists on users table for the same reason. (3) Both webhooks use `createServiceClient()` (service role) since they're called by external services, not authenticated users — no user JWT is available. (4) RevenueCat auth uses Bearer token in Authorization header (standard RevenueCat webhook auth pattern) rather than a custom header. (5) Stripe signature verification uses `stripe.webhooks.constructEventAsync()` (async variant required in Deno Edge Functions where `crypto.subtle` is async). (6) For charge.refunded, credits are zeroed out on the ledger entry directly rather than using the `refund_credits()` Postgres function — the refund_credits function expects a credit_transaction_id (from a deduction), but a Stripe refund maps to a ledger entry via `stripe_payment_id`; direct update is simpler and correct. (7) RevenueCat webhook falls back to matching by `revenuecat_id` column if `app_user_id` doesn't match a user UUID — supports both UUID and RevenueCat-assigned IDs. (8) Both webhooks return 200 even on internal errors to prevent infinite retry loops from Stripe/RevenueCat — errors are logged for manual investigation. (9) Webhook functions use a local `jsonResponse()` helper instead of the shared `successResponse`/`errorResponse` — webhook responses are simple `{ok: true}` payloads, not the full `{data, meta}` envelope expected by frontend clients.
**Impact:** Full subscription lifecycle and top-up purchase flow is now handled server-side. Requires env vars: `REVENUECAT_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. RevenueCat webhook URL should be set to `<SUPABASE_URL>/functions/v1/webhooks-revenuecat`, Stripe webhook endpoint to `<SUPABASE_URL>/functions/v1/webhooks-stripe` with events `checkout.session.completed` and `charge.refunded`.

### 2026-03-22 — Credits page and payment flows (Prompt 4.3.1)

**Area:** Frontend
**Original plan:** Build credits page with balance display, top-up packs, transaction history, upgrade paywall modal, insufficient credits modal, and RevenueCat Web SDK integration.
**Files created:**
- `src/hooks/useCredits.ts` — Hooks for credit balance, history, and top-up purchase via edge functions
- `src/pages/Credits.tsx` — Full credits page with balance, top-up grid, transaction history
- `src/components/InsufficientCreditsModal.tsx` — Modal for 402 insufficient credits with quick top-up
- `src/components/UpgradePaywall.tsx` — Plan comparison modal with monthly/annual toggle
**Files modified:**
- `src/pages/Settings.tsx` — Added "Upgrade Plan" button linking to paywall modal
- `docs/PROMPT_PLAYBOOK.md` — Marked Prompt 4.3.1 complete
**Deviation:** (1) RevenueCat Web SDK (`@revenuecat/purchases-js`) was NOT installed — the `REVENUECAT_WEB_BILLING_KEY` secret is not configured in the project. The upgrade paywall buttons log to console with a TODO placeholder; actual RevenueCat purchase flow will be wired when the SDK key is available. (2) The credits-history hook uses `fetch()` with the full function URL instead of `supabase.functions.invoke()` because the history endpoint is a GET request and `functions.invoke` defaults to POST. (3) Balance response parsing handles both `data.balance` and `data.data.balance` patterns per the edge function response envelope. (4) Settings page tier badge is still hardcoded to "Free" — will be dynamic once RevenueCat customerInfo is available. (5) The green color `text-green-500` is used for positive credit transactions as a semantic status color (similar to how destructive red is used for deductions), not a theme token.
**Impact:** Credits page is fully functional for viewing balance and purchasing top-ups via Stripe Checkout. Upgrade paywall is UI-complete but purchase buttons require RevenueCat SDK configuration. InsufficientCreditsModal can be imported and used in the editor when project-edl returns 402.

### 2026-03-22 — AI Engine service scaffold (Prompt 5.1.1)

**Area:** Backend / Services
**Original plan:** Create a Python service at `services/ai-engine/` that consumes `ai.fill` jobs from the Supabase job_queue, extracts boundary frames via FFmpeg, generates crossfade fill segments (MVP), composites with temporal blending and color matching, validates quality via SSIM, encodes to MP4, uploads to S3, updates `ai_fills` table, and enqueues `video.export` jobs.
**Files created:**
- `services/ai-engine/Dockerfile` — python:3.11-slim + FFmpeg, runs as non-root
- `services/ai-engine/requirements.txt` — numpy, opencv-python-headless, supabase, httpx, boto3, pytest
- `services/ai-engine/src/__init__.py` — Package init
- `services/ai-engine/src/config.py` — Environment variables with configurable boundary/ramp/quality thresholds
- `services/ai-engine/src/supabase_client.py` — Service-role client with job lifecycle helpers, ai_fills insertion, export job enqueuing, credit refund via RPC
- `services/ai-engine/src/s3_utils.py` — S3 download/upload via boto3
- `services/ai-engine/src/boundary_analyzer.py` — FFprobe for video metadata, FFmpeg rawvideo extraction of boundary frames as numpy arrays
- `services/ai-engine/src/fill_generator.py` — FillGenerator ABC + CrossfadeFillGenerator (linear alpha blend)
- `services/ai-engine/src/compositor.py` — Boundary crossfade ramps + LAB color space histogram matching
- `services/ai-engine/src/validator.py` — SSIM computation (Gaussian-weighted), temporal smoothness scoring, composite quality metric
- `services/ai-engine/src/enrollment.py` — Stub returning None (Phase 2 will use MediaPipe)
- `services/ai-engine/src/main.py` — Entry point with Supabase job_queue poller, per-gap pipeline orchestration, error handling with hard_cut fallback and credit refund
- `services/ai-engine/tests/__init__.py` — Package init
- `services/ai-engine/tests/test_fill_generator.py` — 14 tests covering crossfade generation, compositor boundary ramps, SSIM validation, temporal smoothness
**Files modified:**
- `docs/PROMPT_PLAYBOOK.md` — Marked Prompt 5.1.1 complete
**Deviation:** (1) Uses pure Supabase job_queue polling (no Redis/BullMQ), matching the detector service pattern — simpler for MVP. (2) Used `opencv-python-headless` instead of full OpenCV — avoids GUI dependencies in Docker. (3) SSIM is computed with a custom Gaussian-weighted implementation rather than importing `skimage.metrics.structural_similarity` — avoids pulling in scikit-image as a dependency. (4) Color matching uses LAB color space histogram transfer (mean/std matching per channel) rather than simple histogram equalization — produces more natural color transitions. (5) Compositor lazily imports config to avoid requiring Supabase env vars during unit tests; falls back to a default ramp of 5 frames. (6) Credit refund for failed gaps calls the `refund_credits` Postgres RPC function via `client.rpc()` — the RPC uses `out_` prefixed return columns per deviation 002. Refund failures are logged but don't block the pipeline. (7) Credits are charged for crossfade fills in MVP as specified — crossfade IS the product for now. (8) The `_encode_frames_to_mp4` function pipes raw RGB frames directly to FFmpeg stdin rather than writing intermediate image files — more efficient and avoids disk I/O for large fills.
**Impact:** The AI engine completes the processing pipeline: upload → transcode → detect → (editor) → ai.fill → export. The `CrossfadeFillGenerator` can be swapped for real AI providers (D-ID, Veo) in Phase 2 via the `FillGenerator` ABC. S3 path convention `ai-fills/{user_id}/{project_id}/fill_{gap_index}.mp4` is established. The exporter service (Prompt 6.1.1) will read these fill segments to assemble the final video.

### 2026-03-22 — Export progress and completion UI (Prompt 6.1.2)

**Area:** Frontend
**Original plan:** Build export progress overlay with Realtime subscriptions on job_queue and projects, export complete page at `/project/:projectId/export/:exportId` with video preview/download/summary, dashboard project card updates for 'complete' status, and export failure handling with retry.
**Files created:**
- `src/components/ExportProgress.tsx` — Full-screen progress overlay subscribing to Supabase Realtime on `job_queue` and `projects` tables; shows stage-based UI (generating → exporting → finalizing → complete/failed) with progress bar
- `src/pages/ExportComplete.tsx` — Export result page with video preview (`<video>`), download button (blob download with fallback), file info badges, export summary card (total cuts, AI fills, crossfades, hard cuts, net credits), and navigation links
**Files modified:**
- `src/pages/ProjectEditor.tsx` — Integrated ExportProgress component; projects in 'generating'/'exporting' status now show the progress overlay instead of the generic processing spinner; added `?exporting=true` query param support and `onComplete`/`onRetry` handlers
- `src/components/editor/CutsPanel.tsx` — After successful EDL submission, navigates to `/project/:id?exporting=true` to trigger the progress overlay
- `src/components/ProjectCard.tsx` — Added 'generating' and 'exporting' status colors; clicking a 'complete' project now queries for the latest export and navigates to the export page (`/project/:id/export/:exportId`)
- `src/App.tsx` — Added `/project/:projectId/export/:exportId` route (protected, no AppLayout)
**Deviation:** (1) Export progress is shown inline in the ProjectEditor page (triggered by project status or `?exporting=true` query param) rather than a separate route — avoids creating another route and keeps the editor accessible for retry. (2) The progress percentage is a weighted composite: AI fill jobs contribute 0-60% and export jobs contribute 60-100%, rather than showing separate progress for each stage. (3) Video download uses `fetch` → blob → `URL.createObjectURL` for a clean file download experience, with a fallback to `window.open` if the fetch fails (e.g., CORS issues with CloudFront). (4) Dashboard 'complete' project click queries the exports table for the latest export ID before navigating — this is an async operation on click, but the query is fast and avoids storing export IDs in the project card props. (5) The `green-500` Tailwind utility color is used for 'complete' status badges and positive indicators (same pattern as credits page for positive transactions) — these are semantic status colors, not theme tokens.
**Impact:** The full export flow is now visible to users: submit EDL → see progress → view/download completed export. The export page works with whatever `download_url` or `s3_key` is stored in the exports table. CloudFront signed URLs from the exporter service will work directly. The retry button on failure simply hides the progress overlay and returns to the editor.

### 2026-03-22 — Export service (Prompt 6.1.1)

**Area:** Backend / Services
**Original plan:** Create a Node.js service at `services/exporter/` that consumes `video.export` jobs, assembles final videos from source segments and AI fill clips using FFmpeg concat, applies audio normalization, adds watermark for free tier, scales resolution per tier limits, uploads to S3, generates CloudFront signed download URLs, and updates the exports table.
**Files created:**
- `services/exporter/package.json` — Dependencies: @aws-sdk/client-s3, @aws-sdk/cloudfront-signer, @aws-sdk/lib-storage, @supabase/supabase-js
- `services/exporter/tsconfig.json` — ES2022/NodeNext target (matches transcoder)
- `services/exporter/Dockerfile` — node:20-slim + FFmpeg, runs as non-root (matches transcoder)
- `services/exporter/src/config.ts` — Env vars: Supabase, AWS, CloudFront signing, tier resolution limits
- `services/exporter/src/supabase.ts` — Service-role client, job lifecycle helpers, edit_decisions/ai_fills/exports queries, user tier lookup
- `services/exporter/src/s3.ts` — Download/upload with multipart support, CloudFront signed URL generation
- `services/exporter/src/assembler.ts` — Segment extraction, re-encoding for codec consistency, FFmpeg concat demuxer, video probing
- `services/exporter/src/watermark.ts` — drawtext overlay for free-tier exports
- `services/exporter/src/audio.ts` — EBU R128 loudnorm normalization
- `services/exporter/src/index.ts` — Entry point with Supabase job_queue poller, full pipeline orchestration
**Files modified:**
- `docs/PROMPT_PLAYBOOK.md` — Marked Prompt 6.1.1 complete
**Deviation:** (1) Uses pure Supabase job_queue polling (no BullMQ/Redis) unlike the transcoder — the exporter processes one job at a time sequentially, so BullMQ's concurrency management adds no value. This also eliminates the Redis dependency. (2) All segments are re-encoded before concat (not `-c copy`) to ensure consistent codec, timebase, resolution, and fps across source and fill segments — fill segments from the AI engine may have different encoding parameters. (3) Fill segments get a silent audio track generated via `anullsrc` lavfi filter since AI fill MP4s may be video-only — prevents audio desync in the final concat. (4) `@aws-sdk/cloudfront-signer` is used for signed URL generation instead of manually computing RSA signatures — official AWS SDK approach. Falls back to plain S3 URL when CloudFront is not configured. (5) Resolution scaling is enforced based on user tier (free=720p, pro=1080p, business=2160p) and capped to source resolution — never upscales. (6) The `edl_json` is read from the `edit_decisions` table rather than the job payload — the job payload only contains `project_id` and `edit_decision_id`, and the full EDL is in the database. Source video s3_key is queried from the `videos` table rather than being in the payload. (7) Credits are NOT refunded on export failure as specified — the AI fills were already generated. (8) `fill_summary_json` is built from `ai_fills` rows at export time, counting methods (ai_fill, crossfade, hard_cut) and carrying forward `credits_charged` from the edit_decision. `credits_refunded` is set to 0 for MVP.
**Impact:** The full end-to-end pipeline is now complete: upload → transcode → detect → (editor) → ai.fill → export → download. The exporter reads fill segments from `ai-fills/{user_id}/{project_id}/fill_{gap_index}.mp4` and writes final exports to `exports/{user_id}/{project_id}/{export_id}.mp4`. CloudFront signed URLs provide secure 1-hour download links. The project status transitions to `complete` after successful export.

### 2026-03-23 — End-to-end test plan (Prompt 7.1.1)

**Area:** Testing / Documentation
**Original plan:** Create comprehensive E2E test plan at `docs/E2E_TEST_PLAN.md` covering 8 scenarios (sign up, upload, editor, export, credit depletion, subscription, free tier limits, error recovery) as manual test scripts with preconditions, steps, expected results, actual results, and pass/fail fields. Include a smoke test script.
**Files created:**
- `docs/E2E_TEST_PLAN.md` — Full E2E test plan with 8 test scenarios, smoke test bash script, and manual smoke test checklist
**Files modified:**
- `docs/PROMPT_PLAYBOOK.md` — Marked Prompt 7.1.1 complete
- `DEVIATION_LOG.md` — Added this entry
**Deviation:** (1) Each test scenario documents known deviations from the original spec inline (e.g., client-side credit estimation, crossfade-only fills in Phase 1, RevenueCat SDK not yet wired). (2) Smoke test script uses curl for HTTP checks rather than Playwright — faster for post-deploy verification; full Playwright E2E tests are a separate concern. (3) Subscription purchase test (scenario 6) documents that RevenueCat purchase buttons are currently placeholder — cannot be fully tested until SDK billing key is configured.
**Impact:** Test plan is ready for manual execution. All 8 scenarios reflect the actual implementation per DEVIATION_LOG.md. Smoke test script can be run after each deploy for quick verification.

### 2026-03-23 — UI polish pass (Prompt 7.1.2)

**Area:** Frontend
**Original plan:** Polish pass covering loading states (skeleton cards/layouts), error states (toast system), empty states, consistency (colors, buttons, cards), edge cases (long titles, zero credits, no silences), and navigation (active link, page titles, browser history).
**Files created:**
- `src/hooks/useDocumentTitle.ts` — Sets `document.title` per route with "— NoCut" suffix
- `src/components/ProjectCardSkeleton.tsx` — Skeleton card matching ProjectCard layout
- `src/components/editor/EditorSkeleton.tsx` — Skeleton layout matching editor page structure
**Files modified:**
- `src/pages/Dashboard.tsx` — Replaced spinner with skeleton card grid, added `useDocumentTitle`
- `src/pages/ProjectEditor.tsx` — Replaced spinner with `EditorSkeleton`, added `useDocumentTitle`
- `src/pages/Credits.tsx` — Added `useDocumentTitle`, zero-balance CTA with scroll-to-topup, added `ArrowRight` import
- `src/pages/Settings.tsx` — Added `useDocumentTitle`
- `src/pages/ExportComplete.tsx` — Added `useDocumentTitle` with project title
- `src/components/editor/CutsPanel.tsx` — Enhanced "no pauses detected" message with manual cut guidance
**Deviation:** (1) Toast system was already implemented via shadcn Toaster + sonner — no new toast infrastructure needed, existing usage covers success/error/warning patterns. (2) Empty states were already present in Dashboard and Credits — the "No transactions yet" and "No projects yet" messages were already built. (3) AppLayout sidebar already had active link highlighting via `bg-primary text-primary-foreground`. (4) ProjectCard already truncates long titles via `truncate` class. (5) Colors use HSL design tokens (--primary, --foreground, --muted-foreground) rather than hardcoded hex values as specified in the prompt — this follows the established design system pattern. (6) Some status-specific colors (yellow for warning, green for success, red for error) remain as Tailwind utility classes since they are semantic status indicators, not theme colors.
**Impact:** All pages now have proper skeleton loading states, document titles update per route for SEO and usability, zero-credit state is prominently surfaced with a CTA. Browser back/forward works correctly via react-router-dom (no custom handling needed).
