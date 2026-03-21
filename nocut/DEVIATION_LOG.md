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
