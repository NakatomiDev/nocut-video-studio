# NoCut — P0 Implementation Guide

**Version:** 1.0
**Date:** March 2026
**Scope:** All P0 features from PRD v1.2 (Phase 1 MVP)
**Timeline:** Weeks 1–8

---

## Table of Contents

- [Overview](#overview)
- [Tool Strategy](#tool-strategy)
- [Sprint 0: Project Setup](#sprint-0-project-setup-week-1)
- [Sprint 1: Auth & Core UI](#sprint-1-auth--core-ui-weeks-1-2)
- [Sprint 2: Upload Pipeline](#sprint-2-upload-pipeline-weeks-2-3)
- [Sprint 3: Detection & Timeline Editor](#sprint-3-detection--timeline-editor-weeks-3-5)
- [Sprint 4: Credit System & Payments](#sprint-4-credit-system--payments-weeks-4-5)
- [Sprint 5: AI Fill Engine (v0)](#sprint-5-ai-fill-engine-v0-weeks-5-7)
- [Sprint 6: Export Pipeline](#sprint-6-export-pipeline-weeks-6-7)
- [Sprint 7: Integration & Polish](#sprint-7-integration--polish-week-8)
- [Dependency Graph](#dependency-graph)
- [Environment Setup Checklist](#environment-setup-checklist)

---

## Overview

### P0 Features (Phase 1 MVP)

| # | Feature | Tool |
|---|---------|------|
| 1 | Supabase authentication (email/password + OAuth) | Lovable + Claude Code |
| 2 | Video upload (chunked, resumable) | Lovable + Claude Code |
| 3 | Auto silence/pause detection | Claude Code |
| 4 | Timeline editor (basic manual cuts) | Lovable |
| 5 | AI fill generation (short gaps ≤ 2s) | Claude Code |
| 6 | Credit system (monthly allowance + balance tracking) | Claude Code |
| 7 | Top-up credit purchases (Stripe one-time payments) | Lovable + Claude Code |
| 8 | Basic video export (MP4) | Claude Code |
| 9 | RevenueCat integration (web + Stripe) | Lovable + Claude Code |

### What Each Tool Does

**Lovable** — Frontend application. Everything the user sees and interacts with: pages, components, layouts, navigation, state management, API calls to Supabase, RevenueCat Web SDK, Stripe Checkout redirects.

**Claude Code** — Backend infrastructure. Everything behind the scenes: Supabase Edge Functions, database schema and migrations, RLS policies, S3 configuration, ECS task definitions, Python services (detection, AI engine), FFmpeg pipelines, BullMQ queue setup, webhook handlers, Terraform/IaC.

---

## Tool Strategy

### When to Use Lovable

- Building UI pages and components (sign-in, dashboard, upload, editor, export, settings, paywall)
- Wiring up Supabase Auth (sign-up/sign-in flows, session management, protected routes)
- Connecting to Supabase DB via the JS client (reading projects, cut maps, credit balance)
- Integrating RevenueCat Web SDK (displaying offerings, purchase flow, subscription management)
- Integrating Stripe Checkout (redirect to Stripe for top-up purchases)
- Building the timeline editor UI (Canvas-based waveform, thumbnails, cut overlays)
- Real-time updates via Supabase Realtime subscriptions (job progress, credit changes)
- Any visual, interactive, or client-side logic

### When to Use Claude Code

- Writing Supabase Edge Functions (all `/functions/v1/*` endpoints)
- Creating and managing database schema (SQL migrations, RLS policies, indexes)
- Writing webhook handlers (RevenueCat + Stripe event processing)
- Building the credit ledger logic (atomic deduction, refund, expiry)
- Configuring AWS infrastructure (S3 buckets, ECS task definitions, IAM roles)
- Writing Python services (silence detection, AI fill engine, speaker enrollment)
- Writing FFmpeg scripts (transcoding, proxy generation, video assembly)
- Setting up BullMQ queues and worker processes
- Docker configuration for ECS workers
- Terraform/IaC for all cloud resources
- CI/CD pipeline (GitHub Actions)
- Any backend logic, infrastructure, or processing pipeline

### Where They Overlap

Some features require work in both tools, built in sequence:

```
Claude Code: Create the Edge Function + DB schema
    ↓
Lovable: Build the UI that calls the Edge Function
    ↓
Claude Code: Test end-to-end, fix edge cases
```

---

## Sprint 0: Project Setup (Week 1)

Everything needed before writing feature code.

### 0.1 — Repository & Project Initialization

| Task | Tool | Details |
|------|------|---------|
| Create GitHub monorepo | Claude Code | Initialize repo structure per Architecture doc. Directories: `supabase/`, `services/`, `infra/`, `docs/` |
| Initialize Supabase project | Claude Code | `supabase init`, configure project ref, link to hosted Supabase instance |
| Create Lovable app | Lovable | Initialize new Lovable project. Connect to the Supabase project (URL + anon key). Set up Tailwind. |
| Copy docs into repo | Claude Code | Place all 5 docs into `docs/` directory. Update README. |

### 0.2 — Supabase Database Schema

| Task | Tool | Details |
|------|------|---------|
| Create `users` table + trigger | Claude Code | Auto-create user row on Supabase Auth sign-up. Include `tier`, `revenuecat_id`. |
| Create `projects` table | Claude Code | With status enum, foreign key to users. |
| Create `videos` table | Claude Code | S3 keys, duration, resolution, proxy references. |
| Create `cut_maps` table | Claude Code | JSON columns for cuts and transcript. |
| Create `edit_decisions` table | Claude Code | EDL JSON, credit cost, status. |
| Create `ai_fills` table | Claude Code | Per-gap fill results with provider, quality score. |
| Create `exports` table | Claude Code | Final export metadata, download URLs. |
| Create `credit_ledger` table | Claude Code | Monthly allowance + top-up entries with expiry. |
| Create `credit_transactions` table | Claude Code | Deduction/refund audit trail. |
| Create `job_queue` table | Claude Code | Async job tracking with status and progress. |
| Create `audit_log` table | Claude Code | AI generation accountability. |
| Set up RLS policies on all tables | Claude Code | Users can only access their own data. Service role bypasses for Edge Functions. |
| Create database indexes | Claude Code | Index on `user_id`, `project_id`, `status`, `expires_at` for credit queries. |

### 0.3 — AWS Infrastructure

| Task | Tool | Details |
|------|------|---------|
| Create S3 bucket with lifecycle rules | Claude Code | Bucket: `nocut-media`. Prefixes per Architecture doc. Lifecycle policies for auto-cleanup. |
| Create IAM roles | Claude Code | Role for ECS tasks (S3 read/write). Role for Edge Functions (presigned URL generation). |
| Create CloudFront distribution | Claude Code | Origin: S3 bucket. Signed URLs enabled. |
| Set up ECR repositories | Claude Code | Repos for: `nocut-transcoder`, `nocut-detector`, `nocut-ai-engine`, `nocut-exporter`. |
| Create ElastiCache Redis cluster | Claude Code | For BullMQ queues. Redis 7.x. |
| Create ECS cluster | Claude Code | Fargate cluster for non-GPU workers. |
| Terraform all the above | Claude Code | `infra/terraform/` with modules for each component. |

### 0.4 — Third-Party Setup

| Task | Tool | Details |
|------|------|---------|
| Create RevenueCat project | Manual | Dashboard: create "NoCut" project, connect Stripe, add Web Billing platform. |
| Create RevenueCat products | Manual | 4 subscription products (Pro Monthly/Annual, Business Monthly/Annual). |
| Configure RevenueCat entitlements | Manual | `pro` and `business` entitlements mapped to products. |
| Configure RevenueCat webhook | Manual | Point to Supabase Edge Function URL. Set auth header. |
| Create Stripe top-up products | Manual | 4 one-time products (10/30/75/200 credits). |
| Configure Stripe webhook | Manual | Point to Supabase Edge Function URL for `checkout.session.completed`. |

---

## Sprint 1: Auth & Core UI (Weeks 1–2)

### 1.1 — Authentication (Lovable + Claude Code)

| Task | Tool | Details |
|------|------|---------|
| Build sign-up page | Lovable | Email/password form. "Sign up with Google" button. Link to sign-in. |
| Build sign-in page | Lovable | Email/password form. "Sign in with Google" button. Forgot password link. |
| Implement Supabase Auth integration | Lovable | `supabase.auth.signUp()`, `signInWithPassword()`, `signInWithOAuth()`. Session persistence. |
| Build auth guard (protected routes) | Lovable | Redirect unauthenticated users to sign-in. Wrap all app routes. |
| Build password reset flow | Lovable | Reset request page + reset confirmation page. |
| Write `handle_new_user` DB trigger | Claude Code | On auth.users insert: create `users` row, allocate 5 free credits to `credit_ledger`. |
| Test auth end-to-end | Both | Sign up → verify user in Supabase DB → sign in → access protected page → sign out. |

### 1.2 — App Shell & Navigation (Lovable)

| Task | Tool | Details |
|------|------|---------|
| Build app layout (sidebar/header) | Lovable | Logo, navigation links (Dashboard, Credits, Settings), user avatar/menu. |
| Build dashboard page | Lovable | List of projects (empty state for new users). "New Project" button. |
| Build settings page | Lovable | Account info, subscription status, "Manage Subscription" link. |
| Build empty project card component | Lovable | Thumbnail, title, status badge, created date, actions menu. |
| Set up routing | Lovable | `/`, `/sign-in`, `/sign-up`, `/dashboard`, `/project/:id`, `/credits`, `/settings`. |

---

## Sprint 2: Upload Pipeline (Weeks 2–3)

### 2.1 — Upload Backend (Claude Code)

| Task | Tool | Details |
|------|------|---------|
| Write `/upload/initiate` Edge Function | Claude Code | Validate file metadata against tier limits. Generate presigned S3 URLs for chunks. Create project + video DB rows. |
| Write `/upload/chunk-complete` Edge Function | Claude Code | Track chunk completion in DB. Return progress percentage. |
| Write `/upload/complete` Edge Function | Claude Code | Trigger S3 multipart assembly. Validate checksum. Update project status to `transcoding`. Enqueue transcode job. |
| Write presigned URL generation utility | Claude Code | AWS SDK v3 for generating S3 presigned URLs in Edge Functions. |
| Test upload Edge Functions | Claude Code | Unit tests + integration test with S3. |

### 2.2 — Transcoding Worker (Claude Code)

| Task | Tool | Details |
|------|------|---------|
| Write transcoding Python/Node worker | Claude Code | FFmpeg: transcode to H.264/AAC, generate 360p proxy, extract waveform JSON, generate thumbnail sprite sheet. |
| Create Docker image for transcoder | Claude Code | Dockerfile with FFmpeg, push to ECR. |
| Create ECS Fargate task definition | Claude Code | CPU/memory allocation, environment variables, S3 access. |
| Wire up BullMQ consumer | Claude Code | Worker polls `video.transcode` queue. Updates job status + Supabase DB on completion. |
| Update project status on completion | Claude Code | Worker sets project status to `detecting` and enqueues detection job. |

### 2.3 — Upload UI (Lovable)

| Task | Tool | Details |
|------|------|---------|
| Build upload page/modal | Lovable | Drag-and-drop zone. File type validation (MP4, MOV, WebM, MKV). Size display. |
| Implement chunked upload logic | Lovable | Chunk file into 5MB pieces. Upload in parallel (4 concurrent). Report chunk completion to Edge Function. |
| Build upload progress UI | Lovable | Progress bar with percentage. Upload speed. ETA. Cancel button. |
| Build transcoding progress UI | Lovable | After upload completes, show "Processing..." with spinner. Subscribe to Supabase Realtime for project status updates. |
| Handle upload errors | Lovable | Network failures (retry with exponential backoff). File too large. Duration exceeded. Unsupported format. |
| Test full upload flow | Both | Select file → upload chunks → assembly → transcoding → proxy available. |

---

## Sprint 3: Detection & Timeline Editor (Weeks 3–5)

### 3.1 — Silence Detection Service (Claude Code)

| Task | Tool | Details |
|------|------|---------|
| Write silence detection Python service | Claude Code | Read audio from S3 video file. Analyze RMS energy. Identify silence regions (> 1.5s, < -40dBFS). Output cut map JSON. |
| Create Docker image for detector | Claude Code | Python + librosa/pydub + FFmpeg for audio extraction. Push to ECR. |
| Create ECS Fargate task definition | Claude Code | CPU-optimized instance. Environment variables. |
| Wire up BullMQ consumer | Claude Code | Worker polls `video.detect` queue. Writes cut map to Supabase DB. Updates project status to `ready`. |
| Write cut map to Supabase | Claude Code | Insert into `cut_maps` table with structured JSON. Notify via Supabase Realtime. |
| Test detection accuracy | Claude Code | Test with 10+ sample videos. Verify silence regions are correctly identified. Tune thresholds. |

### 3.2 — Timeline Editor (Lovable)

This is the most complex frontend component and the longest Lovable sprint.

| Task | Tool | Details |
|------|------|---------|
| Build editor page layout | Lovable | Split view: video preview (top), timeline (bottom). Sidebar for cut list and credit estimate. |
| Build `PreviewPlayer` component | Lovable | HTML5 video player loading the proxy URL. Play/pause, seek, volume. Synced with timeline playhead. |
| Build `TimelineContainer` component | Lovable | Root component managing zoom, scroll, playhead position. Canvas-based rendering. |
| Build `WaveformTrack` component | Lovable | Load waveform JSON. Render as Canvas bitmap. Pan/zoom with timeline. |
| Build `ThumbnailTrack` component | Lovable | Load thumbnail sprite sheet. Render filmstrip below waveform. Lazy-load at zoom level. |
| Build `SilenceOverlay` component | Lovable | Render semi-transparent blue overlays on silence regions from cut map. Click to toggle (include/exclude from cuts). |
| Build `ManualCutTool` | Lovable | Click on timeline to add a manual cut point. Drag to define region. Delete button on each manual cut. |
| Build `PlayheadCursor` component | Lovable | Vertical line synced with video playback. Draggable for seeking. |
| Build cut list sidebar | Lovable | List all cuts (auto-detected + manual). Toggle each on/off. Show type and duration. |
| Build `CreditEstimate` component | Lovable | Calculate total fill duration from active cuts. Display "Estimated credits: X". Call `/estimate` endpoint. Real-time update as user edits. |
| Build "Export" button with confirmation | Lovable | Shows credit cost, resolution, format. "Confirm & Use X Credits" button. Calls `/edl` endpoint. |
| Wire up Supabase data loading | Lovable | Load project, video, cut map, proxy URL, waveform URL on editor page mount. |
| Handle editor loading states | Lovable | Loading skeleton while transcoding/detecting. "Ready" state when cut map is available. |
| Test editor with real data | Both | Upload a video → detection → open editor → see waveform + silences → make cuts → verify credit estimate. |

---

## Sprint 4: Credit System & Payments (Weeks 4–5)

### 4.1 — Credit Ledger Backend (Claude Code)

| Task | Tool | Details |
|------|------|---------|
| Write `/credits/balance` Edge Function | Claude Code | Query `credit_ledger` for non-expired entries with remaining credits. Return breakdown (monthly vs. top-up). |
| Write `/credits/history` Edge Function | Claude Code | Query `credit_transactions` with pagination. Return formatted history. |
| Write credit deduction function | Claude Code | Atomic Postgres transaction: query ledger (monthly first, oldest first, then top-up), deduct across entries, create transaction record. |
| Write credit refund function | Claude Code | Reverse deduction: add credits back to original ledger entries, create refund transaction. |
| Write credit expiry cron | Claude Code | Supabase pg_cron job: set `credits_remaining = 0` on expired ledger entries daily. |
| Write `/projects/:id/edl` Edge Function | Claude Code | Calculate required credits. Call deduction function. On success: create `edit_decisions` row, enqueue `ai.fill` job. On failure: return 402 with top-up options. |
| Write `/projects/:id/estimate` Edge Function | Claude Code | Calculate credits without deducting. Return estimate + current balance. |
| Test credit deduction edge cases | Claude Code | Monthly before top-up. Spanning multiple ledger entries. Exact balance. Zero balance. Expired entries skipped. |

### 4.2 — RevenueCat Integration (Claude Code + Lovable)

| Task | Tool | Details |
|------|------|---------|
| Write `/webhooks/revenuecat` Edge Function | Claude Code | Verify auth header. Handle `INITIAL_PURCHASE`, `RENEWAL`, `PRODUCT_CHANGE`, `CANCELLATION`, `EXPIRATION`, `BILLING_ISSUE`, `UNCANCELLATION`. Allocate credits on purchase/renewal. Update user tier. |
| Install RevenueCat Web SDK | Lovable | `npm install @revenuecat/purchases-js`. Configure with Web Billing API key. |
| Initialize RevenueCat on app load | Lovable | `Purchases.configure(apiKey, supabaseUserId)` after auth session established. |
| Build paywall page | Lovable | Fetch offerings via `Purchases.getSharedInstance().getOfferings()`. Display Pro/Business plans with pricing, features, credit allocation. Highlight annual as recommended. |
| Implement subscription purchase flow | Lovable | `Purchases.getSharedInstance().purchase({ rcPackage })`. Handle success (refresh tier + credits). Handle cancellation and errors. |
| Build subscription management link | Lovable | "Manage Subscription" button on settings page. Opens `customerInfo.managementURL`. |
| Build upgrade prompts | Lovable | Triggered when user hits tier limits (file too large, duration exceeded, fill duration exceeded). Show relevant plan comparison. |
| Test subscription lifecycle | Both | Purchase → verify webhook → verify credits allocated → renewal → cancellation → expiration → verify downgrade. |

### 4.3 — Stripe Top-Up Integration (Claude Code + Lovable)

| Task | Tool | Details |
|------|------|---------|
| Write `/credits/topup` Edge Function | Claude Code | Create Stripe Checkout session with product ID, user ID in metadata, success/cancel URLs. Return checkout URL. |
| Write `/webhooks/stripe` Edge Function | Claude Code | Verify Stripe signature. On `checkout.session.completed`: allocate top-up credits (1-year expiry). On `charge.refunded`: deduct credits or flag. |
| Build credits page | Lovable | Show current balance (monthly vs. top-up). Show credit history. Show 4 top-up packs with "Buy" buttons. |
| Build "Buy Credits" flow | Lovable | On click: call `/credits/topup` → redirect to Stripe Checkout URL → handle success return (refresh balance). |
| Build "Low Credits" prompt | Lovable | Show warning banner when balance < 5 credits. Link to credits page. |
| Build "Insufficient Credits" modal | Lovable | Triggered by 402 response from `/edl`. Show available vs. required. Quick top-up buttons + upgrade link. |
| Test top-up lifecycle | Both | Purchase top-up → Stripe webhook → credits appear in balance → use credits → verify deduction order (monthly first). |

---

## Sprint 5: AI Fill Engine (v0) (Weeks 5–7)

### 5.1 — AI Engine Service (Claude Code)

| Task | Tool | Details |
|------|------|---------|
| Write Face Enrollment module | Claude Code | MediaPipe Face Mesh on sampled frames. Extract speaker embedding. Encrypt and store in S3. Save metadata in Supabase. |
| Write Boundary Analyzer module | Claude Code | FFmpeg frame extraction. OpenCV face detection. Compute pose/expression/lighting deltas. Estimate fill duration. |
| Write provider abstraction layer | Claude Code | `FillGenerator` interface. `MockFillGenerator` for testing (returns crossfade). Prepare adapters for D-ID/HeyGen. |
| Write D-ID or HeyGen adapter | Claude Code | Map boundary frames → API parameters. Call provider API. Parse generated frames from response. |
| Write Temporal Compositor module | Claude Code | 5-frame crossfade blending. Color matching (LAB histogram transfer). Grain matching from source. FFmpeg segment encoding. |
| Write Quality Validator module | Claude Code | SSIM computation. Face embedding comparison. Optical flow analysis. Composite scoring. Pass/fail decision. |
| Write fallback logic | Claude Code | Retry with adjusted params → crossfade → hard cut. Credit refund trigger for non-AI fallbacks. |
| Create Docker image for AI Engine | Claude Code | Python + PyTorch + MediaPipe + OpenCV + FFmpeg. CUDA support. Push to ECR. |
| Create EC2 GPU launch template | Claude Code | g5.xlarge. Auto-scaling group based on `ai.fill` queue depth. Spot instance configuration. |
| Wire up BullMQ consumer | Claude Code | GPU worker polls `ai.fill` queue. Processes each gap sequentially. Updates Supabase DB with results. |
| Write fill result handler | Claude Code | On completion: update `ai_fills` table, update `edit_decisions` status, calculate credits used vs. refunded, trigger export if all gaps done. |
| Test AI fill end-to-end | Claude Code | Upload → detection → submit EDL → credit deduction → AI fill generation → verify quality → segments in S3. |

### 5.2 — AI Fill UI Updates (Lovable)

| Task | Tool | Details |
|------|------|---------|
| Build generation progress UI | Lovable | After EDL submission: show "Generating AI fills..." with per-gap progress. Subscribe to Realtime updates on `job_queue`. |
| Build generation result summary | Lovable | After generation: show how many AI fills, crossfades, hard cuts. Credits used vs. refunded. "Continue to Export" button. |
| Handle generation failures | Lovable | Show error message. "Credits have been refunded" confirmation. "Try Again" button. |

---

## Sprint 6: Export Pipeline (Weeks 6–7)

### 6.1 — Export Service (Claude Code)

| Task | Tool | Details |
|------|------|---------|
| Write video assembly module | Claude Code | FFmpeg concat demuxer: stitch real segments + AI fill segments per EDL order. Maintain audio continuity with crossfades at boundaries. |
| Write audio normalization module | Claude Code | FFmpeg loudnorm filter. Normalize to -16 LUFS. |
| Write watermark module | Claude Code | FFmpeg drawtext/overlay filter for free tier watermark ("Made with NoCut"). Skipped for Pro/Business. |
| Write C2PA signing module | Claude Code | Embed Content Credentials metadata marking AI-generated segment timestamps. |
| Write format encoding module | Claude Code | Encode to MP4 (H.264/AAC). Resolution based on tier (720p free, 1080p pro, 4K business). |
| Create Docker image for exporter | Claude Code | FFmpeg + C2PA tools. Push to ECR. |
| Create ECS Fargate task definition | Claude Code | CPU-optimized. Environment variables. S3 access for reading segments and writing final export. |
| Wire up BullMQ consumer | Claude Code | Worker polls `video.export` queue. Updates progress in Supabase DB. Uploads final file to S3. Generates CloudFront signed URL. |
| Write `/exports/:id/status` Edge Function | Claude Code | Return export status, progress, download URL when complete. |
| Write `/exports/:id/download` Edge Function | Claude Code | Generate fresh CloudFront signed URL with 1-hour expiry. |
| Update project status on completion | Claude Code | Set project status to `complete`. Insert `exports` row. Trigger notification. |
| Test export end-to-end | Claude Code | AI fills in S3 → export job → assembled video → watermark on free tier → download URL works. |

### 6.2 — Export UI (Lovable)

| Task | Tool | Details |
|------|------|---------|
| Build export progress UI | Lovable | After generation: "Assembling your video..." with progress bar. Realtime subscription on `job_queue` + `exports`. |
| Build export complete page | Lovable | Video preview player (streaming from CloudFront). "Download" button. Export summary (fills, credits used/refunded). Share options (copy link). |
| Build export history on project page | Lovable | List previous exports for a project with download links. |
| Handle export failures | Lovable | Error message. "Try Again" button. Credits already refunded by backend. |

---

## Sprint 7: Integration & Polish (Week 8)

### 7.1 — End-to-End Integration Testing (Both)

| Task | Tool | Details |
|------|------|---------|
| Test full happy path | Both | Sign up → upload → detection → edit → credit check → AI fill → export → download. |
| Test free tier limits | Both | 3 exports/month limit → upgrade prompt. 5-min duration limit → rejection. 720p export. Watermark present. |
| Test credit flows | Both | Monthly credits consumed first → top-up consumed second → insufficient credits → top-up purchase → retry succeeds. |
| Test subscription lifecycle | Both | Purchase Pro → 60 credits allocated → cancel → credits valid until period end → expiration → downgrade to free → 5 free credits. |
| Test error recovery | Both | Upload failure mid-chunk → resume. Detection failure → retry. AI fill failure → fallback + refund. Export failure → retry. |

### 7.2 — Polish & UX (Lovable)

| Task | Tool | Details |
|------|------|---------|
| Loading states everywhere | Lovable | Skeleton loaders on dashboard. Spinners on async operations. Disabled buttons during processing. |
| Error toasts | Lovable | Consistent toast notifications for errors, successes, warnings. |
| Empty states | Lovable | Dashboard with no projects. Credits page with no history. Editor before detection completes. |
| Responsive design check | Lovable | Verify app works on common desktop viewport sizes (1280×720 through 2560×1440). Mobile not required for MVP. |
| Onboarding hints | Lovable | First-time user: tooltip on "Upload" button. First-time editor: brief explanation of silence regions. |

### 7.3 — Deployment & CI/CD (Claude Code)

| Task | Tool | Details |
|------|------|---------|
| Set up GitHub Actions | Claude Code | Lint + test on PR. Deploy Edge Functions to staging on merge to `develop`. Manual promote to production on merge to `main`. |
| Set up staging environment | Claude Code | Separate Supabase project. 1/4 scale AWS resources. RevenueCat sandbox mode. Stripe test mode. |
| Set up production environment | Claude Code | Production Supabase. Full AWS resources. RevenueCat production. Stripe live mode. |
| Configure monitoring | Claude Code | Datadog APM on ECS workers. CloudWatch alarms on queue depth. Supabase dashboard for Edge Function metrics. |
| Production deploy | Claude Code | Deploy all Edge Functions. Push Docker images. Apply Terraform. Run DB migrations. Verify health checks. |
| Lovable production deploy | Lovable | Publish to production. Configure custom domain (app.nocut.app). Verify. |

---

## Dependency Graph

This shows which sprints block which. Tasks within a sprint can often be parallelized (Claude Code backend work + Lovable frontend work simultaneously).

```
Sprint 0 (Setup)
    ├──→ Sprint 1 (Auth + Shell)
    │        ├──→ Sprint 2 (Upload)
    │        │        ├──→ Sprint 3 (Detection + Editor)
    │        │        │        ├──→ Sprint 5 (AI Fill)
    │        │        │        │        └──→ Sprint 6 (Export)
    │        │        │        │                 └──→ Sprint 7 (Polish)
    │        └──→ Sprint 4 (Credits + Payments)
    │                 ├──→ Sprint 5 (AI Fill) [credits required before AI fill]
    │                 └──→ Sprint 7 (Polish)
```

**Parallelization opportunities:**

- Sprint 1: Auth backend (Claude Code) and shell UI (Lovable) in parallel
- Sprint 2: Upload Edge Functions (Claude Code) and Upload UI (Lovable) in parallel (mock API initially)
- Sprint 3: Detection service (Claude Code) and Timeline editor UI (Lovable) in parallel (use sample cut map data)
- Sprint 4: Credit backend (Claude Code) and Paywall UI (Lovable) in parallel
- Sprint 5 + 6: AI fill (Claude Code) can start while export UI (Lovable) is built
- Sprint 7: Backend testing (Claude Code) and UI polish (Lovable) in parallel

**With two parallel workstreams (Lovable + Claude Code), effective timeline is ~6 weeks, not 8.**

---

## Environment Setup Checklist

### Before Sprint 0

- [ ] GitHub repository created with monorepo structure
- [ ] Supabase account created, project provisioned
- [ ] AWS account created, billing enabled
- [ ] Stripe account created, verified
- [ ] RevenueCat account created (Pro plan)
- [ ] Lovable account created
- [ ] Domain registered (nocut.app or similar)
- [ ] Team access configured (GitHub, Supabase, AWS, Stripe, RevenueCat, Lovable)

### API Keys & Secrets Needed

| Secret | Where It's Used | Stored In |
|--------|----------------|-----------|
| `SUPABASE_URL` | Lovable app, Edge Functions | Lovable env vars |
| `SUPABASE_ANON_KEY` | Lovable app | Lovable env vars |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions, ECS workers | Supabase Vault, AWS Secrets Manager |
| `REVENUECAT_API_KEY` | Edge Functions (server-side entitlement checks) | Supabase Vault |
| `REVENUECAT_WEB_BILLING_KEY` | Lovable app (Web SDK) | Lovable env vars (public key, safe to expose) |
| `REVENUECAT_WEBHOOK_SECRET` | Edge Function webhook handler | Supabase Vault |
| `STRIPE_SECRET_KEY` | Edge Functions (Checkout session creation) | Supabase Vault |
| `STRIPE_WEBHOOK_SECRET` | Edge Function webhook handler | Supabase Vault |
| `AWS_ACCESS_KEY_ID` | Edge Functions (presigned URLs), ECS workers | Supabase Vault, AWS Secrets Manager |
| `AWS_SECRET_ACCESS_KEY` | Same | Same |
| `AWS_S3_BUCKET` | Edge Functions, ECS workers | Supabase Vault, AWS Secrets Manager |
| `AWS_CLOUDFRONT_KEYPAIR_ID` | Edge Functions (signed URLs) | Supabase Vault |
| `AWS_CLOUDFRONT_PRIVATE_KEY` | Edge Functions (signed URLs) | Supabase Vault |
| `REDIS_URL` | ECS workers (BullMQ) | AWS Secrets Manager |
| `GCP_VERTEX_AI_KEY` (Phase 2) | AI Engine | AWS Secrets Manager |

### Lovable Prompt Strategy

When prompting Lovable, reference the NoCut docs for context. Effective patterns:

```
"Build a sign-in page for NoCut. Use Supabase Auth with email/password and Google OAuth.
After sign-in, redirect to /dashboard. Use Tailwind for styling. Dark sidebar navigation
with logo, Dashboard, Credits, and Settings links."
```

```
"Build a timeline editor component. It should render an HTML Canvas showing an audio
waveform loaded from a JSON URL. Overlay semi-transparent blue regions for each cut
in a cuts array [{start, end, type}]. Allow clicking a region to toggle it on/off.
Show a vertical playhead that syncs with a video element above the timeline."
```

### Claude Code Prompt Strategy

When using Claude Code, reference the specific architecture sections:

```
"Write a Supabase Edge Function at /functions/v1/upload/initiate that:
1. Validates the request body (filename, file_size_bytes, mime_type, duration_seconds, resolution)
2. Checks the user's tier limits from the users table
3. Generates presigned S3 PUT URLs for each 5MB chunk using AWS SDK v3
4. Creates a project and video row in Supabase
5. Returns the presigned URLs and project ID
Reference: Architecture doc Section 4.3, API Reference Section 4.1"
```

```
"Write the credit deduction logic as a Postgres function that:
1. Takes user_id and required_credits as input
2. Queries credit_ledger for non-expired entries with credits_remaining > 0
3. Orders by type (monthly_allowance first) then granted_at (oldest first)
4. Atomically deducts across entries in a SERIALIZABLE transaction
5. Creates a credit_transactions record
6. Returns success/failure with remaining balance
Reference: Architecture doc Section 6.5, Credit System Section 6.2"
```
