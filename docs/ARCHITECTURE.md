# NoCut — Technical Architecture

**Version:** 2.0
**Date:** March 2026
**Status:** Draft (Aligned with PRD v1.2)
**Classification:** Confidential

---

## Table of Contents

- [1. System Overview](#1-system-overview)
- [2. High-Level Architecture](#2-high-level-architecture)
- [3. Frontend Architecture](#3-frontend-architecture)
- [4. Backend Architecture](#4-backend-architecture)
- [5. AI Video Continuity Engine](#5-ai-video-continuity-engine)
- [6. Credit System Architecture](#6-credit-system-architecture)
- [7. RevenueCat & Stripe Integration](#7-revenuecat--stripe-integration)
- [8. Data Architecture](#8-data-architecture)
- [9. Job Queue Architecture](#9-job-queue-architecture)
- [10. Infrastructure & Deployment](#10-infrastructure--deployment)
- [11. Security Architecture](#11-security-architecture)
- [12. Observability & Monitoring](#12-observability--monitoring)
- [13. Architecture Decision Records](#13-architecture-decision-records)

---

## 1. System Overview

NoCut is a web-based video editing system that ingests raw video, analyzes it for removable segments, provides an interactive editing experience, generates AI-synthesized filler footage, and delivers polished single-take exports. The MVP is **web-only** (mobile deferred to Phase 3).

The system is built on three platform pillars:

- **Lovable** — frontend application (React/TypeScript)
- **Supabase** — authentication, database (PostgreSQL), Edge Functions, and Realtime
- **AWS + GCP** — video storage/processing (AWS S3, CloudFront) and AI model inference (AWS GPU instances, with GCP for models only available on Vertex AI or GCP-hosted endpoints)

**Design Principles:**

- **Supabase-First Backend:** Business logic lives in Supabase Edge Functions wherever possible, minimizing custom infrastructure. Only GPU-bound workloads (AI generation, transcoding) run on dedicated compute.
- **Pipeline-Oriented:** Each stage of the video workflow is an independent service communicating via job queues, enabling horizontal scaling of bottleneck stages.
- **Proxy-First Editing:** The timeline editor operates on lightweight proxy files. Full-resolution processing only happens at export time.
- **Credit-Gated Generation:** Every AI fill operation checks the user's credit balance before executing. Credits are the primary cost-control mechanism.
- **Multi-Cloud by Necessity:** AWS is the primary cloud for storage and compute. GCP is used selectively when specific AI models (e.g., Imagen Video, Veo) are only available on Vertex AI or GCP-hosted endpoints.
- **Privacy-by-Design:** Speaker models are encrypted at rest, scoped to the uploading user, and automatically purged after a configurable retention period.

---

## 2. High-Level Architecture

### 2.1 Service Map

| Service | Runtime | Responsibility | Scaling Strategy |
|---------|---------|---------------|-----------------|
| **Web App** | Lovable (React/TypeScript) | UI, timeline editor, preview playback, paywall, credit dashboard | Lovable-hosted; CDN-served static assets |
| **API Layer** | Supabase Edge Functions | Auth, routing, entitlement enforcement, credit checks, CRUD operations, webhook processing | Auto-scaled by Supabase platform |
| **Upload Service** | Supabase Edge Functions + AWS S3 | Presigned URL generation, chunk tracking, upload validation | Supabase auto-scale; S3 handles storage |
| **Transcoding Worker** | AWS ECS Fargate (FFmpeg) | Video transcoding, proxy generation, waveform extraction, thumbnail sprites | Horizontal auto-scale on queue depth |
| **Detection Service** | AWS ECS Fargate (Python) | Silence detection, filler word detection (Phase 2), transcript generation | Horizontal; CPU-bound, queue-driven |
| **AI Engine** | AWS EC2 GPU (primary) + GCP Vertex AI (select models) | Face enrollment, gap analysis, motion synthesis, compositing | GPU auto-scale on queue depth; GCP for specific model endpoints |
| **Export Service** | AWS ECS Fargate (FFmpeg) | Video assembly, audio normalization, watermarking, C2PA signing | Horizontal; CPU-bound |
| **Notification Service** | Supabase Edge Functions | Email and in-app notifications for job completion | Auto-scaled by Supabase |

### 2.2 Data Flow

The end-to-end data flow for a single video project:

1. **Client Upload:** User selects video file in Lovable app. App chunks the file (5MB per chunk) and uploads via presigned S3 URLs obtained from a Supabase Edge Function. Upload progress tracked in Supabase DB.
2. **Intake & Proxy:** On upload completion, a Supabase Edge Function validates the file (codec, resolution, duration vs. tier limits) and enqueues a transcoding job. Transcoding Worker (ECS Fargate + FFmpeg) transcodes to H.264/1080p, generates 360p proxy, extracts waveform data, and creates thumbnail sprites. Results written to S3; metadata updated in Supabase DB.
3. **Detection:** Detection Service (ECS Fargate, Python) pulls video from S3. MVP (Phase 1): analyzes audio for silence/pauses. Phase 2: runs Whisper for transcription, detects filler words and repeated segments. Outputs structured cut map (JSON) to Supabase DB.
4. **Editing:** Lovable app loads proxy video and cut map from Supabase. User reviews auto-detected silence regions, makes manual cuts. Client sends final edit decision list (EDL) to Supabase.
5. **Credit Check:** Supabase Edge Function calculates total credits required (1 credit per second of AI fill needed), checks user's credit balance, deducts credits atomically. If insufficient credits, returns error with upgrade/top-up prompt.
6. **AI Fill Generation:** AI Engine receives the EDL. For each gap, extracts boundary frames from source video on S3. Routes to appropriate model (AWS GPU for primary model, GCP Vertex AI for specific models if needed). Generates synthetic bridge footage. Uploads generated segments to S3.
7. **Export:** Export Service (ECS Fargate) assembles final video from original + AI-generated segments. Applies audio normalization, watermark (if free tier), and C2PA metadata. Encodes to output format, uploads to S3/CloudFront.
8. **Delivery:** Supabase Edge Function sends notification (in-app via Supabase Realtime + email). Video available for streaming preview and download via CloudFront signed URL.

### 2.3 Multi-Cloud Strategy

| Concern | Primary (AWS) | Secondary (GCP) | Decision Criteria |
|---------|--------------|-----------------|-------------------|
| Video Storage | S3 + CloudFront | — | All video assets live in AWS. No cross-cloud storage. |
| Transcoding / Export | ECS Fargate + FFmpeg | — | CPU workloads stay on AWS for S3 proximity. |
| Silence Detection | ECS Fargate (Python) | — | Lightweight audio analysis, no GPU needed. |
| AI Model Inference | EC2 GPU (g5.xlarge) | Vertex AI endpoints | Default: AWS GPU. GCP only when a specific model (e.g., Google Veo, Imagen Video) is unavailable on AWS or performs materially better. |
| Database / Auth / API | Supabase (hosted) | — | Supabase is cloud-agnostic (hosted platform). |

**Cross-Cloud Data Transfer:** When GCP AI endpoints are used, boundary frames are sent as base64 payloads in the API request (not stored on GCS). Generated frames are returned in the response and written directly to S3. This minimizes cross-cloud storage and keeps S3 as the single source of truth for all video assets.

---

## 3. Frontend Architecture

### 3.1 Web Application (Lovable)

The web app is built entirely in **Lovable**, leveraging its AI-assisted development for rapid iteration. Lovable generates a React + TypeScript application with built-in hosting.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Platform | Lovable | AI-assisted development, built-in hosting, rapid iteration on UI |
| Framework (generated) | React 19 + TypeScript | Component model suits complex editor UI; strong ecosystem |
| Styling | Tailwind CSS (via Lovable) | Utility-first, consistent design tokens, Lovable default |
| State Management | Zustand | Lightweight, performant; ideal for timeline state |
| API Client | Supabase JS Client + TanStack Query | Native Supabase integration for auth/DB; TanStack Query for caching and upload retry logic |
| Video Decoding | WebCodecs API (with WASM fallback) | Hardware-accelerated frame extraction for timeline thumbnails |
| Timeline Rendering | HTML Canvas | Waveform and thumbnail rendering; performance-critical path |
| Payments | RevenueCat Web SDK + Stripe Elements | Subscriptions via RevenueCat; top-up credit purchases via Stripe Checkout |
| Realtime | Supabase Realtime | Job progress updates, notification delivery |

### 3.2 Timeline Editor Component Architecture

The timeline editor is the core UI component. For MVP, it focuses on essential functionality.

**MVP Components (Phase 1):**

- **TimelineContainer:** Root component. Manages zoom level, scroll position, and playhead state.
- **WaveformTrack:** Canvas-rendered audio waveform. Pre-computed at proxy generation time.
- **ThumbnailTrack:** Filmstrip of video thumbnails. Lazy-loaded at current zoom level.
- **SilenceOverlay:** Highlighted regions showing auto-detected silence. User can click to confirm or dismiss.
- **ManualCutTool:** Click-to-split tool for adding custom cut points.
- **PreviewPlayer:** Basic video preview reflecting current edit state using proxy video with client-side skip logic.
- **CreditEstimate:** Displays estimated credits required for current edits (calculated from total gap duration).

**Phase 2 Components (deferred):**

- **CutRegionOverlay:** Enhanced overlays with one-click accept/reject and drag-to-resize edges. Color-coded by type (silence = blue, filler = orange, repeat = purple).
- **TranscriptPanel:** Synchronized transcript view with clickable words for setting cut points.
- **KeyboardShortcutManager:** Keyboard shortcuts for rapid editing workflow.
- **EnhancedPreview:** Real-time preview of edits before AI fill generation.

**Performance Targets:**

- Timeline panning/zooming: 60fps on mid-range hardware
- Thumbnail generation: < 2 seconds for first visible thumbnails after upload
- Cut adjustment feedback: < 16ms latency from interaction to visual update
- Preview playback: Instant skip between edit points (no buffering)

### 3.3 Mobile Applications (Phase 3 — Deferred)

Mobile apps (iOS/Android) are out of scope for the MVP. When developed in Phase 3, they will connect to the same Supabase backend and AWS/GCP infrastructure. Mobile-specific considerations include background upload, 240p proxy compression, and RevenueCat mobile SDK integration for cross-platform subscription sync.

---

## 4. Backend Architecture

### 4.1 Supabase as the Backend Platform

Supabase serves as the primary backend platform, providing auth, database, Edge Functions (serverless API), and Realtime. This replaces the need for a custom Node.js API gateway for most operations.

| Supabase Component | Role in NoCut |
|--------------------|---------------|
| **Supabase Auth** | User authentication (email/password, Google OAuth, Apple Sign-In). JWT tokens for session management. |
| **PostgreSQL** | Primary database for all application data: users, projects, videos, cut maps, edit decisions, credit ledger, audit log. |
| **Row-Level Security (RLS)** | Authorization layer. Users can only access their own data. No application-level auth bugs. |
| **Edge Functions** | Serverless API endpoints for all client-facing operations: upload initiation, EDL submission, credit checks, entitlement enforcement, webhook processing (RevenueCat + Stripe). |
| **Realtime** | Push job progress updates to the client (transcoding %, detection complete, AI fill progress, export ready). Also used for credit balance updates. |
| **Storage** | Not used for video files (S3 handles that). Used for small assets like user avatars and project thumbnails. |

### 4.2 Edge Function Responsibilities

Supabase Edge Functions (Deno-based serverless functions) handle all API logic:

- **`/upload/initiate`** — Validates file metadata against tier limits. Generates presigned S3 URLs for chunked upload. Creates project and video records in DB.
- **`/upload/complete`** — Verifies all chunks uploaded. Triggers S3 multipart completion. Enqueues transcoding job.
- **`/project/{id}/cut-map`** — Returns the auto-detected cut map for the timeline editor.
- **`/project/{id}/edl`** — Receives the final edit decision list from client. Calculates required credits. Deducts credits atomically. Enqueues AI fill jobs.
- **`/credits/balance`** — Returns user's current credit balance (monthly + top-up, with expiry info).
- **`/credits/topup`** — Creates a Stripe Checkout session for one-time credit pack purchase.
- **`/webhooks/revenuecat`** — Processes RevenueCat subscription lifecycle events. Allocates monthly credits on purchase/renewal.
- **`/webhooks/stripe`** — Processes Stripe one-time payment events for top-up credit purchases.
- **`/export/{id}/status`** — Returns export job status. Also available via Supabase Realtime subscription.

### 4.3 Upload Pipeline

Designed for reliability with large files over unstable connections.

1. **Initiate:** Client calls `/upload/initiate`. Edge Function validates file metadata, checks tier limits (duration, resolution, file size), creates DB records, returns presigned S3 URLs for each 5MB chunk.
2. **Upload Chunks:** Client uploads chunks in parallel (up to 4 concurrent) directly to S3. Reports chunk completion to Edge Function which updates DB.
3. **Assembly:** On all chunks reported, Edge Function triggers S3 multipart upload completion. Validates checksum.
4. **Transcode Job:** Edge Function publishes a `video.transcode` job (via Supabase DB-backed queue or external queue). Transcoding Worker picks it up.
5. **Transcoding:** ECS Fargate worker (FFmpeg) transcodes to H.264/AAC, generates 360p proxy, extracts audio waveform data (JSON), generates thumbnail sprite sheet. Writes all outputs to S3, updates Supabase DB.
6. **Detection:** On transcode completion, a `video.detect` job is enqueued. Detection Service picks it up.

| Tier | Max File Size | Max Duration | Max Resolution |
|------|--------------|-------------|---------------|
| Free | 4 GB | 5 minutes | 1080p input |
| Pro | 10 GB | 30 minutes | 1080p input |
| Business | 25 GB | 2 hours | 4K input |

### 4.4 Detection Pipeline

The Detection Service runs on ECS Fargate (Python) and consumes `video.detect` jobs.

**MVP (Phase 1) — Silence Detection Only:**

- Analyzes audio RMS energy against configurable threshold (default: -40dBFS)
- Minimum silence duration: 1.5s (configurable per user preference)
- Outputs: Array of `{ start, end, duration, confidence }` objects
- Writes structured cut map JSON to Supabase DB
- Notifies client via Supabase Realtime that detection is complete

**Phase 2 — Full Detection Pipeline:**

- **Transcription (Whisper):** Whisper large-v3 for word-level timestamps and confidence scores. Real-time factor target: < 0.3x.
- **Filler Word Detection:** Context-aware classifier running against Whisper transcript. Default filler set: "um," "uh," "like," "you know," "so," "basically," "actually."
- **Repeated Segment Detection:** Semantic similarity (sentence embeddings) to find retake clusters. Ranks by audio clarity, speech confidence, delivery pace.

**Cut Map Output Schema:**

```json
{
  "video_id": "uuid",
  "duration": 300.5,
  "transcript": { "words": [...], "language": "en" },
  "cuts": [
    {
      "id": "cut_001",
      "type": "silence | filler | repeat",
      "start": 12.34,
      "end": 15.67,
      "confidence": 0.92,
      "auto_accept": true,
      "metadata": { ... }
    }
  ]
}
```

---

## 5. AI Video Continuity Engine

This is the core technical differentiator of NoCut. The engine generates synthetic speaker footage that visually bridges gaps created by removing unwanted segments. **Every second of generated footage consumes 1 credit from the user's balance.**

### 5.1 Architecture Overview

| Component | Technology | Cloud | Purpose |
|-----------|-----------|-------|---------|
| **Face Enrollment** | MediaPipe Face Mesh + custom encoder | AWS GPU | Builds speaker embedding from source footage: facial geometry, skin texture, lighting profile |
| **Boundary Analyzer** | OpenCV + custom heuristics | AWS GPU | Extracts boundary frames, computes pose/expression/lighting delta between cut points |
| **Motion Generator** | Diffusion-based video model | AWS GPU (primary) or GCP Vertex AI | Generates intermediate frames conditioned on boundary frames and speaker embedding |
| **Lip Sync Module** | Wav2Lip / SyncNet (optional) | AWS GPU | Generates lip-synced mouth movement if audio bridge is provided |
| **Temporal Compositor** | Custom blending pipeline (PyTorch + FFmpeg) | AWS GPU | Blends generated frames with real frames using temporal smoothing, color/grain matching |

### 5.2 Multi-Cloud Model Routing

The AI Engine sits behind a **provider-agnostic abstraction layer** that routes generation requests to the appropriate backend:

- **Default Route (AWS):** Most generation jobs run on AWS EC2 GPU instances (g5.xlarge with NVIDIA A10G). This is the primary path for licensed APIs (D-ID, HeyGen) and for the eventual custom model.
- **GCP Route (Vertex AI):** When a specific model is only available on GCP (e.g., Google's Veo video generation model, Imagen for frame super-resolution), the abstraction layer routes the request to a GCP Vertex AI endpoint.
- **Routing Decision:** The model router checks a configuration table in Supabase that maps `(generation_type, quality_tier)` to a `provider` (aws_gpu, gcp_vertex, licensed_api). This allows A/B testing between providers and gradual migration.

**Cross-Cloud Data Handling:** Boundary frames are sent to GCP endpoints as base64 in the API payload (not stored on GCS). Generated frames return in the response body and are immediately written to S3. No persistent video data lives on GCP.

### 5.3 Generation Pipeline

1. **Credit Verification:** Before any generation begins, the Supabase Edge Function has already verified and deducted credits. The AI Engine receives a pre-authorized job with a `credit_transaction_id`.
2. **Input Preparation:** Extract boundary frames (last 15 frames before cut, first 15 frames after cut). Load speaker embedding from enrollment. Compute pose/expression/lighting delta.
3. **Model Routing:** Check the model routing config. Select AWS GPU, GCP Vertex AI, or licensed API endpoint.
4. **Generation:** Model generates N frames (at 30fps, 1s fill = 30 frames). Generation at 512×512, then super-resolved to target resolution. Quality threshold check (SSIM > 0.85).
5. **Compositing:** Temporal crossfade blending (5-frame ramp per side). Color grading via histogram transfer. Film grain/noise matching.
6. **Validation:** Face identity verification (embedding cosine similarity ≥ 0.95), temporal consistency (optical flow smoothness), lip sync accuracy check.
7. **Output:** Generated segment uploaded to S3. Supabase DB updated. Client notified via Realtime.

### 5.4 Model Strategy

| Approach | Pros | Cons | Timeline |
|----------|------|------|----------|
| **License (D-ID, HeyGen, Runway API)** | Fast to market. No ML team needed. Proven quality. | Per-generation cost (but offset by credit pricing). Vendor dependency. Latency. | Phase 2 launch |
| **GCP Vertex AI models** | Access to Google's latest video models (Veo). Managed serving. | Cross-cloud latency. GCP dependency for specific capability. | Phase 2 (selective) |
| **Build Custom Model** | Full control. Optimized unit economics at scale. Unique IP. | Requires ML team (2–3 engineers). 6–12 months. High upfront GPU cost. | Phase 3–4 transition |

**Recommendation:** Launch Phase 2 with a licensed API on AWS behind the abstraction layer, with GCP Vertex AI as a secondary option for specific model capabilities. Begin custom model development in Phase 3. The abstraction layer ensures provider swaps are transparent to the rest of the system.

### 5.5 Performance Requirements

| Metric | Target | Measurement |
|--------|--------|-------------|
| Generation latency (1s fill) | < 30 seconds | End-to-end from job start to segment in S3 |
| Generation latency (3s fill) | < 90 seconds | Same |
| Quality score (SSIM) | ≥ 0.85 | Against boundary frames |
| Identity preservation | ≥ 0.95 cosine similarity | Speaker embedding of generated vs. source |
| Temporal smoothness | No visible seam at boundaries | Optical flow discontinuity < threshold |
| Throughput | 100 concurrent fill jobs | At steady-state with auto-scaled GPU fleet |

### 5.6 Fallback Strategy

When confidence falls below the quality threshold (0.85):

1. **Level 1 — Retry with adjusted parameters:** Re-run with increased diffusion steps and tighter conditioning. Costs an additional credit (user is informed).
2. **Level 2 — Crossfade:** Apply a smooth 0.5s crossfade between boundary frames. Visually similar to a morph cut. **No credit cost** (not AI generation).
3. **Level 3 — Hard cut with audio smoothing:** Traditional jump cut with audio crossfade. **No credit cost.**

The user is informed which method was used. Failed AI fills that consumed credits are refunded automatically.

---

## 6. Credit System Architecture

### 6.1 Overview

The credit system meters AI video generation (the primary cost driver). It is managed entirely in Supabase PostgreSQL, not in RevenueCat, because RevenueCat handles subscriptions but not consumable credit ledgers.

**Core Rule:** 1 credit = 1 second of AI-generated fill footage.

### 6.2 Database Schema

```sql
-- Credit ledger: one row per credit grant (monthly allowance or top-up purchase)
CREATE TABLE credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('monthly_allowance', 'top_up')),
  credits_granted INTEGER NOT NULL,
  credits_remaining INTEGER NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  stripe_payment_id TEXT,
  revenuecat_event_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Credit transactions: one row per deduction or refund
CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  project_id UUID REFERENCES projects(id),
  type TEXT NOT NULL CHECK (type IN ('deduction', 'refund')),
  credits INTEGER NOT NULL,
  ledger_entries JSONB NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS policies
ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own credits" ON credit_ledger FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users see own transactions" ON credit_transactions FOR SELECT USING (auth.uid() = user_id);
```

### 6.3 Credit Allocation (Monthly)

When RevenueCat sends an `INITIAL_PURCHASE` or `RENEWAL` webhook:

1. Edge Function (`/webhooks/revenuecat`) processes the event.
2. Determines tier and monthly credit allocation (Free: 5, Pro: 60, Business: 200).
3. Inserts `credit_ledger` row: `type = 'monthly_allowance'`, `expires_at = granted_at + 2 months`.
4. Updates user's cached tier.

### 6.4 Credit Allocation (Top-Up)

When Stripe sends `checkout.session.completed` for a top-up purchase:

1. Edge Function (`/webhooks/stripe`) processes the event.
2. Maps Stripe product ID to credit amount (10, 30, 75, or 200).
3. Inserts `credit_ledger` row: `type = 'top_up'`, `expires_at = granted_at + 1 year`.

### 6.5 Credit Deduction (AI Fill)

When a user submits an EDL:

1. Calculate total credits: `SUM(gap_duration_seconds)` for all gaps.
2. Query `credit_ledger` for non-expired rows with `credits_remaining > 0`, ordered by: monthly_allowance first (oldest first), then top_up (oldest first).
3. Atomic Postgres transaction deducts across ledger entries.
4. If insufficient: reject with `{ error: 'insufficient_credits', available, required, topup_url }`.
5. On success: create `credit_transactions` row, enqueue AI fill job with `credit_transaction_id`.

### 6.6 Credit Refund (Failed Fill)

If AI fill fails and fallback produces a non-AI result:

1. Export Service reports failure to Supabase.
2. Edge Function creates refund `credit_transactions` row.
3. Credits added back to original ledger entries.
4. User notified via Realtime.

### 6.7 Credit Expiry

Daily cron (Supabase Edge Function) sets `credits_remaining = 0` on all rows where `expires_at < now()`. Rows retained for audit.

---

## 7. RevenueCat & Stripe Integration

### 7.1 Scope Split

| Concern | Handled By | Reason |
|---------|-----------|--------|
| Recurring subscriptions | RevenueCat + Stripe | Unified entitlement management, paywall UI, analytics |
| One-time credit top-ups | Stripe directly | RevenueCat is optimized for subscriptions, not one-time consumables |
| Entitlement checks (feature gating) | RevenueCat REST API (cached) | Determines feature access (fill duration, resolution, etc.) |
| Credit balance (consumption gating) | Supabase DB (credit_ledger) | Determines how many seconds of AI fill available |
| Webhook processing | Supabase Edge Functions | Both RevenueCat and Stripe webhooks processed by Edge Functions |

### 7.2 Entitlement + Credit Enforcement Flow

Every API request triggering AI generation passes through a two-layer gate:

1. **Authentication:** Supabase Auth validates JWT.
2. **Entitlement Check:** Edge Function queries RevenueCat `GET /subscribers/{user_id}` (cached 60s). Checks `ai_fill` entitlement and tier's max fill duration.
3. **Credit Check:** Edge Function queries `credit_ledger` for available credits. Checks balance ≥ required.
4. **Gate Decision:**
   - Both pass: deduct credits, enqueue job.
   - Entitlement fails: 403 with upgrade prompt.
   - Credits insufficient: 402 with top-up prompt.

### 7.3 Webhook Event Handling

| Source | Event | Action |
|--------|-------|--------|
| RevenueCat | `INITIAL_PURCHASE` | Update tier. Allocate monthly credits. Welcome email. |
| RevenueCat | `RENEWAL` | Allocate monthly credits for new period. Refresh cache. |
| RevenueCat | `PRODUCT_CHANGE` | Update tier. Allocate prorated credits for remainder of period. |
| RevenueCat | `CANCELLATION` | Mark as cancelling. Credits valid until period end. Trigger retention flow. |
| RevenueCat | `EXPIRATION` | Downgrade to free. Stop allocating. Existing credits valid until individual expiry. |
| RevenueCat | `BILLING_ISSUE` | Flag account. Billing reminder. 3-day grace period. |
| Stripe | `checkout.session.completed` (top-up) | Verify product. Allocate top-up credits. Confirmation email. |
| Stripe | `charge.refunded` (top-up) | Deduct refunded credits. If consumed, flag for manual review. |

### 7.4 Configuration

**Subscription Products (RevenueCat):** `nocut_pro_monthly` ($14.99/mo, 60 credits), `nocut_pro_annual` ($119.88/yr, 60 credits/mo), `nocut_business_monthly` ($39.99/mo, 200 credits), `nocut_business_annual` ($359.88/yr, 200 credits/mo).

**Top-Up Products (Stripe):** `nocut_credits_10` ($4.99), `nocut_credits_30` ($11.99), `nocut_credits_75` ($24.99), `nocut_credits_200` ($54.99).

**Entitlements:** `ai_fill`, `export_video`, `hd_export`, `transcript_edit`, `multi_speaker`, `batch_processing`, `priority_queue`, `brand_overlays`.

---

## 8. Data Architecture

### 8.1 Database Schema (Supabase PostgreSQL)

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `users` | id, email, supabase_uid, revenuecat_id, tier, created_at | User accounts. Tier cached from RevenueCat. |
| `projects` | id, user_id, title, status, created_at | One project per uploaded video. |
| `videos` | id, project_id, s3_key, duration, resolution, format, proxy_s3_key | Source video metadata and S3 references. |
| `cut_maps` | id, video_id, version, cuts_json, transcript_json | Auto-detected and user-edited cut decisions. |
| `edit_decisions` | id, project_id, edl_json, total_fill_seconds, status, created_at | Final EDL. Includes credit cost. |
| `ai_fills` | id, edit_decision_id, gap_index, s3_key, method, quality_score, duration, provider | AI-generated fill segments. `provider` tracks AWS/GCP/licensed. |
| `exports` | id, project_id, s3_key, format, resolution, watermarked, c2pa_signed, created_at | Final exported videos. |
| `speaker_models` | id, user_id, embedding_s3_key, created_at, expires_at | Encrypted speaker model references. Auto-purged. |
| `credit_ledger` | id, user_id, type, credits_granted, credits_remaining, granted_at, expires_at | Credit balance tracking. See Section 6.2. |
| `credit_transactions` | id, user_id, project_id, type, credits, ledger_entries, reason | Credit deduction/refund audit trail. |
| `job_queue` | id, type, payload, status, priority, attempts, created_at, completed_at | Supabase-managed queue for lightweight async work. |
| `audit_log` | id, user_id, action, input_hash, output_hash, metadata, timestamp | AI generation accountability log. |

### 8.2 Storage Architecture (AWS S3)

| Bucket / Prefix | Contents | Lifecycle |
|-----------------|----------|-----------|
| `uploads/{user_id}/{project_id}/source.*` | Original uploaded video | Project lifetime + 30 days |
| `uploads/{user_id}/{project_id}/proxy.*` | 360p proxy | Project lifetime |
| `uploads/{user_id}/{project_id}/waveform.json` | Audio waveform data | Project lifetime |
| `uploads/{user_id}/{project_id}/thumbnails/` | Thumbnail sprite sheets | Project lifetime |
| `ai-fills/{user_id}/{project_id}/{fill_id}.*` | AI-generated fill segments | 90 days after export |
| `exports/{user_id}/{project_id}/{export_id}.*` | Final exported videos | 90 days (free) / 1 year (paid) |
| `speaker-models/{user_id}/{model_id}.enc` | Encrypted speaker embeddings | 30 days inactivity auto-purge |

### 8.3 Caching Strategy

| Cache | Backend | TTL | Purpose |
|-------|---------|-----|---------|
| Entitlement cache | Supabase DB (cached column) | 60 seconds | Avoid per-request RevenueCat API calls |
| Credit balance | Computed from credit_ledger | Real-time (DB query) | Atomic checks, no cache |
| Cut map | Supabase DB | Session duration | Loaded once when editor opens |
| Thumbnails | CloudFront + IndexedDB (client) | 24 hours | Avoid re-generating thumbnails |
| Speaker model | GPU instance local SSD | Session duration | Avoid re-download for consecutive fills |
| Model routing config | Supabase DB | 5 minutes | AI Engine provider selection |

---

## 9. Job Queue Architecture

NoCut uses a hybrid queue approach: **Supabase DB-backed queue** for lightweight jobs and **Redis + BullMQ** for heavy compute jobs running on dedicated ECS/GPU infrastructure.

| Queue | Runner | Concurrency | Retry Policy | Priority |
|-------|--------|-------------|-------------|----------|
| `video.transcode` | ECS Fargate (FFmpeg) | 4 per instance | 3 retries, exponential backoff | FIFO |
| `video.detect` | ECS Fargate (Python) | 2 per instance | 3 retries, exponential backoff | FIFO |
| `ai.fill` | EC2 GPU / GCP Vertex AI | 1 per GPU | 2 retries (expensive) | Priority (Business > Pro > Free) |
| `video.export` | ECS Fargate (FFmpeg) | 4 per instance | 3 retries, exponential backoff | Priority (Business > Pro > Free) |
| `notification.send` | Supabase Edge Function | Event-driven | 5 retries | FIFO |
| `credit.allocate` | Supabase Edge Function | Event-driven | 3 retries | FIFO |

**Dead Letter Queue (DLQ):** Jobs exhausting retries go to DLQ. Alert fires. AI fill failures auto-refund credits before DLQ.

**Priority Logic:** `ai.fill` and `video.export` use BullMQ priority. Business = 1, Pro = 5, Free = 10.

**Job Progress:** Workers update Supabase DB. Client receives real-time updates via Supabase Realtime.

---

## 10. Infrastructure & Deployment

### 10.1 Cloud Architecture

| Component | Service | Configuration |
|-----------|---------|---------------|
| Frontend | Lovable (hosted) | Built-in CDN. Custom domain. |
| API / Auth / DB | Supabase (hosted) | Pro plan. PgBouncer pooling. Edge Functions. |
| Transcoding + Export | AWS ECS Fargate | Auto-scale. Min 2, max 20 tasks. |
| Detection | AWS ECS Fargate (CPU-optimized) | c6i instances. Queue-depth scaling. |
| AI Engine (Primary) | AWS EC2 GPU (g5.xlarge) | Auto-scale on queue depth. Spot for Free/Pro. |
| AI Engine (Secondary) | GCP Vertex AI | On-demand endpoints. Scale-to-zero when idle. |
| Video Storage | AWS S3 + Intelligent-Tiering | Lifecycle policies. CloudFront delivery. |
| CDN | AWS CloudFront | Signed URLs. Edge caching. |
| Compute Queue | AWS ElastiCache Redis | Redis 7.x cluster for BullMQ. |
| Secrets | AWS Secrets Manager + Supabase Vault | Infra secrets (AWS). Edge Function secrets (Supabase). |
| Monitoring | Datadog + CloudWatch + GCP Cloud Monitoring | Unified cross-cloud APM. |

### 10.2 Deployment Strategy

- **Frontend:** Auto-deployed by Lovable on publish. Instant rollback via version history.
- **Supabase:** Edge Functions via Supabase CLI. DB migrations via Supabase migrations. Staging project mirrors production.
- **AWS Workers:** GitHub Actions. Path-based triggers. Blue-green ECS. Canary for AI Engine.
- **GCP Endpoints:** Vertex AI model endpoints via Terraform. Versioned model artifacts in GCS.
- **IaC:** Terraform for all AWS and GCP resources. Supabase managed via CLI.
- **Environments:** Dev (local Supabase + Docker Compose), Staging (1/4 scale), Production.

### 10.3 Cost Modeling

| Resource | Est. Monthly (10K MAU) | Est. Monthly (100K MAU) | Notes |
|----------|----------------------|------------------------|-------|
| AWS GPU (AI Engine) | $2,500–$4,500 | $20,000–$35,000 | Largest cost. Spot reduces ~60%. Credit system ties cost to revenue. |
| GCP Vertex AI | $200–$800 | $2,000–$6,000 | GCP-exclusive models only. Scale-to-zero. |
| AWS ECS Fargate | $600–$1,000 | $4,000–$7,000 | Auto-scales. |
| AWS S3 + Transfer | $400–$800 | $3,500–$7,000 | Lifecycle policies critical. |
| AWS CloudFront | $200–$400 | $2,000–$4,000 | Video delivery. |
| AWS ElastiCache Redis | $200 | $600 | Stable. |
| Supabase | $25–$599 | $599–$1,200 | Pro plan. |
| Lovable | $0–$20 | $20 | Hosting included. |
| RevenueCat | $0 (< $2.5K MRR) | $99–$499/mo | Free until $2.5K MRR. |
| Datadog | $200–$500 | $1,000–$3,000 | Cross-cloud monitoring. |
| **TOTAL** | **$4,300–$8,600** | **$33,200–$63,300** | **Target: infra < 30% of MRR.** |

---

## 11. Security Architecture

### 11.1 Authentication & Authorization

- **Authentication:** Supabase Auth with JWT. Email/password, Google OAuth, Apple Sign-In. 1-hour token expiry, rotating refresh tokens.
- **Authorization:** RLS on every table. Users access only their own data.
- **Service-to-Service:** ECS/GCP workers authenticate to Supabase via service role keys in Secrets Manager. Presigned S3 URLs for video access.

### 11.2 Data Protection

- **Encryption at Rest:** S3 SSE (AES-256). Supabase DB encryption (managed). Speaker models additionally encrypted per-user.
- **Encryption in Transit:** TLS 1.3 everywhere. Cross-cloud (AWS ↔ GCP) over TLS.
- **Video Privacy:** Presigned S3 URLs (1-hour expiry). CloudFront signed URLs. No public buckets.
- **Speaker Model Security:** Per-user encryption, never shared, auto-purged after 30 days inactivity, access logged.
- **Credit Integrity:** Postgres `SERIALIZABLE` transactions for credit deductions. Full audit trail in `credit_transactions`.

### 11.3 Cross-Cloud Security

- **GCP Service Account:** Minimal-privilege. Vertex AI API calls only. No GCS access.
- **API Keys:** GCP keys in AWS Secrets Manager. Rotated quarterly.
- **No Persistent GCP Data:** Frames sent as request payloads, not stored. All video data stays in S3.

### 11.4 C2PA Content Provenance

All exports include C2PA metadata: AI-generated segment timestamps, generation method, model version, provider (AWS/GCP/licensed). Compatible with CAI verification tools.

---

## 12. Observability & Monitoring

### 12.1 Key Dashboards

| Dashboard | Metrics | Alert Threshold |
|-----------|---------|----------------|
| Upload Pipeline | Success rate, assembly/transcode time | Success < 99%; transcode > 5 min |
| Detection | Accuracy, processing time/min of video | Processing > 1 min per min of video |
| AI Engine | Generation time, quality scores, fallback rate, GPU util, AWS/GCP split | Fallback > 15%; GPU > 85% sustained |
| Export Pipeline | Assembly time, success rate | Success < 99%; assembly > 3 min |
| Credit System | Granted/consumed/refunded per day, avg credits per export, exhaustion rate | Refund rate > 10%; burn anomaly > 3x avg |
| Revenue | MRR, churn, top-up volume, credits purchased vs. consumed | Churn spike > 2x baseline |
| Queue Health | Depth, processing time, DLQ size | DLQ > 10; depth growing > 10 min |
| Cross-Cloud | GCP latency, error rate, data transfer | GCP errors > 5%; latency > 2x AWS |

### 12.2 Logging Strategy

- **Structured Logging:** JSON logs with correlation IDs (project_id, user_id, job_id, credit_transaction_id) across both clouds.
- **Log Levels:** ERROR (alerts), WARN (investigation), INFO (audit), DEBUG (dev only).
- **Retention:** 30 days hot, 90 days warm, 1 year cold (compliance).
- **Aggregation:** Datadog collects from AWS (CloudWatch), GCP (Cloud Logging), and Supabase (Edge Function logs).

---

## 13. Architecture Decision Records

### ADR-001: Lovable for Frontend

- **Context:** Need rapid frontend development for web-only MVP.
- **Decision:** Build the web app in Lovable.
- **Rationale:** AI-assisted development accelerates iteration. Built-in hosting eliminates frontend DevOps. Generates standard React/TypeScript, so codebase is portable.
- **Trade-off:** Less control over low-level Canvas/WebGL. Mitigated by evaluating early and using external libraries if needed.

### ADR-002: Supabase as Backend Platform

- **Context:** Need auth, database, serverless API, and real-time. Want to minimize custom infrastructure.
- **Decision:** Supabase for Auth + PostgreSQL + Edge Functions + Realtime. All API logic in Edge Functions.
- **Rationale:** Single platform for auth, DB, API, and real-time. RLS eliminates auth bugs. Edge Functions replace custom API gateway. Realtime enables live progress.
- **Trade-off:** Edge Functions are Deno-based. Some npm packages may not work. GPU workloads still need dedicated compute.

### ADR-003: Multi-Cloud (AWS Primary + GCP Secondary)

- **Context:** Some AI models only available on GCP. AWS better for video storage/compute.
- **Decision:** AWS primary for all storage, CDN, compute, queues. GCP selectively for AI model endpoints only.
- **Rationale:** S3 as single source of truth. Access best-in-class AI models regardless of cloud.
- **Trade-off:** Cross-cloud latency for GCP calls. Mitigated by API payloads (not storage sync) and only using GCP when quality justifies it.

### ADR-004: Credit System in Supabase, Not RevenueCat

- **Context:** Need consumable credit tracking. RevenueCat doesn't handle consumable credits well.
- **Decision:** Credit ledger in Supabase PostgreSQL. RevenueCat for subscriptions only. Stripe direct for top-ups.
- **Rationale:** Postgres ACID transactions prevent double-spend. Flexible querying. RLS for isolation.
- **Trade-off:** Two payment touchpoints (RevenueCat + Stripe). Slightly more complex webhooks.

### ADR-005: Proxy-First Editing

- **Context:** Timeline editor needs to handle potentially long (2-hour) videos.
- **Decision:** 360p proxy on upload. Timeline uses proxy only. Full-res at export.
- **Rationale:** 10–20x smaller files. Smooth timeline on slow connections.
- **Trade-off:** Lower preview quality. Acceptable for editing.

### ADR-006: AI Engine Abstraction Layer

- **Context:** Using licensed APIs, GCP models, and eventually custom model. Need to swap between them.
- **Decision:** Provider-agnostic interface with model routing config in Supabase.
- **Rationale:** Transparent provider swaps. A/B testing. Quality scores tracked per-provider.
- **Trade-off:** Abstraction complexity. Worth it for multi-cloud/multi-provider flexibility.

### ADR-007: BullMQ for Compute Queues

- **Context:** Need priority queues with progress tracking for GPU workloads.
- **Decision:** Redis + BullMQ for compute queues. Supabase DB for lightweight queues.
- **Rationale:** BullMQ provides priority, progress events (via Supabase Realtime), rate limiting. Supabase DB simpler for event-driven work.
- **Trade-off:** Redis dependency. Mitigated with ElastiCache cluster mode.
