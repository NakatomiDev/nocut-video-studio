# NoCut — Product Requirements Document

**Version:** 1.1
**Date:** March 2026
**Status:** Draft (Updated per team feedback)
**Classification:** Confidential

---

## Table of Contents

- [1. Executive Summary](#1-executive-summary)
- [2. Target Users & Personas](#2-target-users--personas)
- [3. Product Architecture](#3-product-architecture)
- [4. Feature Specification](#4-feature-specification)
- [5. Monetization & RevenueCat Integration](#5-monetization--revenuecat-integration)
- [6. Technical Constraints & Risks](#6-technical-constraints--risks)
- [7. Ethical & Trust Framework](#7-ethical--trust-framework)
- [8. Development Phases & Timeline](#8-development-phases--timeline)
- [9. Success Criteria & KPIs](#9-success-criteria--kpis)
- [10. Open Questions & Decisions Needed](#10-open-questions--decisions-needed)
- [Appendix A: Glossary](#appendix-a-glossary)

---

## 1. Executive Summary

NoCut is a web-based video editing application that transforms raw, unedited recordings into polished, professional-looking single-take videos. Users upload their unedited footage containing pauses and mistakes. NoCut detects silence and pauses, lets users remove unwanted sections on a simple timeline, and generates AI-synthesized speaker footage to seamlessly bridge the gaps — producing a final video that appears to have been recorded in one continuous, flawless take.

### 1.1 Problem Statement

Content creators, educators, corporate communicators, and social media professionals spend enormous time either re-recording content to get a clean take or manually editing out mistakes in complex video editing software. The gap between "recording a video" and "publishing a polished video" is filled with friction: learning curves for editing tools, hours of manual cut-and-splice work, and visible jump cuts that break the viewing experience.

### 1.2 Solution

NoCut eliminates this gap with a three-step workflow:

1. **Upload** — User records and uploads raw footage, mistakes and all.
2. **Edit** — A Clipchamp-style timeline editor enables intuitive removal of unwanted sections (auto-detected or manual).
3. **Generate** — AI synthesizes speaker footage to fill the gaps, producing a seamless one-take video.

### 1.3 Key Metrics

| Metric | Target (6-Month) | Target (12-Month) |
|--------|-------------------|---------------------|
| Monthly Active Users (MAU) | 10,000 | 100,000 |
| Paid Conversion Rate | 5% | 8% |
| Average Edit-to-Export Time | < 5 minutes | < 3 minutes |
| AI Fill Quality Score (user-rated) | ≥ 4.0 / 5.0 | ≥ 4.5 / 5.0 |
| Monthly Recurring Revenue (MRR) | $25,000 | $200,000 |
| Net Promoter Score (NPS) | ≥ 40 | ≥ 55 |

---

## 2. Target Users & Personas

### 2.1 Primary Personas

| Persona | Description | Pain Point | NoCut Value |
|---------|-------------|------------|-------------|
| **Solo Content Creator** | YouTubers, TikTokers, course creators recording talking-head content | Re-records 5–10x to get a clean take; editing jump cuts takes hours | Record once, export a perfect take in minutes |
| **Corporate Communicator** | Marketing teams, internal comms, HR creating training or announcement videos | Doesn't have editing skills; sends to video team and waits days | Self-service polished video without expertise |
| **Educator / Instructor** | Teachers, professors, online course builders recording lectures | Long recordings with many stumbles; editing is prohibitively tedious | Clean up a 30-min lecture in minutes, not hours |
| **Social Media Manager** | Agency staff or in-house teams producing high-volume short-form video | Volume demands make re-recording impractical; jump cuts look unprofessional | Rapid turnaround on polished, on-brand content |

### 2.2 User Journey

The core user journey follows a four-stage flow from raw recording to published content:

1. **Record:** User records video normally, making mistakes freely without worrying about retakes.
2. **Upload:** User signs in to NoCut (web app, built with Lovable) and uploads their raw video file. Supabase authentication ensures only registered users can access the service.
3. **Edit:** NoCut auto-detects silence and pauses and highlights them on the timeline. User confirms or adjusts cuts using the basic timeline editor.
4. **Export:** NoCut generates AI filler footage, stitches everything together, and exports a seamless one-take video.

---

## 3. Product Architecture

### 3.1 Platform Strategy

NoCut MVP is **web-only**. The web app is the sole platform for Phase 1 and Phase 2, providing the full upload, edit, and export workflow. Mobile apps (iOS and Android) are deferred to Phase 3+ and will be scoped separately once the core product is validated.

The web app is built using **Lovable** for rapid frontend development.

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Web App | Lovable (React + TypeScript) | Rapid development, built-in hosting, AI-assisted iteration |
| Backend API | Node.js microservices | Real-time processing orchestration, job queue management |
| AI Pipeline | Python (PyTorch), GPU cluster | Video generation model serving, inference optimization |
| Storage | AWS S3 / CloudFront CDN | Video asset storage and delivery |
| Auth | Supabase Auth | Email/password + OAuth login, JWT-based session management |
| Payments | RevenueCat (Web via Stripe) | Subscription management; mobile SDK integration deferred to Phase 3 |

### 3.2 Authentication (Supabase)

All access to NoCut requires authentication. Unauthenticated users are redirected to the sign-in/sign-up page.

- **Provider:** Supabase Auth
- **Methods:** Email/password, Google OAuth, Apple Sign-In
- **Session Management:** JWT tokens with 1-hour expiry and rotating refresh tokens
- **Authorization:** Row-Level Security (RLS) in Supabase ensures users can only access their own projects, videos, and exports
- **Entitlement Linking:** On sign-up, the backend creates a corresponding RevenueCat subscriber record using the Supabase user ID as the `app_user_id`, enabling subscription state to be tied to the authenticated user

### 3.3 Core System Components

#### 3.3.1 Video Upload & Transcoding Service

Handles intake of raw video files, validates format and duration, transcodes to standardized processing format, and generates preview proxies for the timeline editor.

- Supported input formats: MP4, MOV, WebM, MKV
- Max upload size: 4GB (free), 10GB (Pro), 25GB (Business)
- Generates low-res proxy for timeline editing and full-res pipeline for export
- Chunked upload with resume capability for large files

#### 3.3.2 Cut Detection Engine

Analyzes uploaded video to identify removable segments.

**MVP (Phase 1):**

- **Silence/Pause Detection:** Identifies gaps in speech exceeding configurable threshold (default 1.5s). This is the core detection capability for the MVP.

**Phase 2 (deferred):**

- **Filler Word Detection:** Transcription-based detection of "um," "uh," "like," "you know," and configurable custom fillers
- **Repeated Segment Detection:** Uses transcript similarity matching to find retakes of the same sentence or paragraph
- **Quality Scoring:** When multiple takes exist, ranks them by audio clarity, confidence, and delivery pace

#### 3.3.3 Timeline Editor

A browser-based timeline editor purpose-built for the cut-and-fill workflow:

**MVP (Phase 1):**

- Waveform + video thumbnail timeline with zoom/scroll
- Auto-detected silence regions shown as highlighted sections on the timeline
- Manual cut tool for splitting and removing custom segments
- Basic video preview of the current edit state

**Phase 2 (deferred):**

- Auto-detected cuts with one-click accept/reject UI
- Transcript-based editing: click on words in transcript to set cut points
- Real-time preview of edits before AI fill generation
- Keyboard shortcuts for rapid editing workflow

#### 3.3.4 AI Video Continuity Engine (Core IP)

This is the central differentiator of NoCut. After the user finalizes their cuts, this engine generates synthetic speaker footage to seamlessly bridge every gap.

**How It Works:**

1. **Face Enrollment:** On first upload, the system builds a speaker model from the existing footage — facial geometry, skin tone, lighting conditions, mannerisms, and micro-expressions.
2. **Gap Analysis:** For each cut, the engine examines the last frame before the cut and the first frame after the cut, determining what transition footage is needed.
3. **Motion Synthesis:** Generates frames showing the speaker with natural idle motion (subtle head movement, blinking, breathing) that bridges the visual gap.
4. **Lip Sync (Optional):** If the user provides a transition script or the AI infers a natural verbal bridge, the generated footage includes lip-synced speech.
5. **Compositing:** Generated frames are blended with the surrounding real footage using temporal smoothing and color matching to eliminate visible seams.

**Quality Requirements:**

- Generated footage must be indistinguishable from real footage at 1080p playback
- Transition duration: 0.5s to 3s depending on gap context
- Lighting, white balance, and camera angle must match source material
- No uncanny valley artifacts in facial movement
- Processing target: < 30 seconds per 1-second fill segment on GPU infrastructure

#### 3.3.5 Export & Delivery Pipeline

Assembles the final video from real + generated segments and delivers in the user's chosen format:

- Output formats: MP4 (H.264/H.265), MOV, WebM
- Resolution options: 720p, 1080p, 4K (tier-dependent)
- Audio normalization and noise reduction pass
- Watermark on free tier exports
- Direct publish to YouTube, TikTok, Instagram, LinkedIn (future)

---

## 4. Feature Specification

### 4.1 Feature Priority Matrix

| Feature | Priority | Phase | Tier |
|---------|----------|-------|------|
| Supabase authentication (email/password + OAuth) | P0 | 1 | Free |
| Video upload (chunked, resumable) | P0 | 1 | Free |
| Auto silence/pause detection | P0 | 1 | Free |
| Timeline editor (basic manual cuts) | P0 | 1 | Free |
| AI fill generation (short gaps ≤ 2s) | P0 | 1 | Credit-gated |
| Credit system (monthly allowance + balance tracking) | P0 | 1 | All tiers |
| Top-up credit purchases (Stripe one-time payments) | P0 | 1 | All tiers |
| Basic video export (MP4) | P0 | 1 | Free |
| RevenueCat integration (web + Stripe) | P0 | 1 | — |
| Credit usage dashboard & low-balance prompts | P1 | 1 | All tiers |
| Filler word detection | P1 | 2 | Free |
| Auto-detected cuts with one-click accept/reject | P1 | 2 | Free |
| Transcript-based editing | P1 | 2 | Pro |
| Real-time preview of edits before AI fill | P1 | 2 | Free |
| Keyboard shortcuts | P1 | 2 | Free |
| Repeated segment detection & best-take selection | P1 | 2 | Pro |
| AI fill generation (long gaps ≤ 5s) | P1 | 2 | Pro |
| Mobile apps (iOS + Android) | P2 | 3 | Free |
| RevenueCat mobile SDK integration | P2 | 3 | — |
| Multi-speaker support | P2 | 3 | Business |
| 4K export | P2 | 3 | Business |
| Batch processing (multiple videos) | P2 | 3 | Business |
| Custom brand overlays & lower thirds | P2 | 3 | Business |
| Direct social media publishing | P2 | 3 | Pro |
| Real-time collaborative editing | P3 | 4 | Business |
| API access for automation | P3 | 4 | Enterprise |

---

## 5. Monetization & RevenueCat Integration

### 5.1 Credit System Overview

NoCut uses a **credit-based system** to meter AI video generation, which is the primary cost driver (GPU compute). Credits provide users with flexibility and NoCut with predictable cost control.

**How Credits Work:**

- **1 credit = 1 second of AI-generated fill footage.** A 2-second fill costs 2 credits.
- Each subscription tier includes a **monthly credit allowance** at a discounted per-credit rate compared to top-ups.
- Users who exhaust their monthly allowance can purchase **top-up credit packs** at any time.
- Upgrading to a higher tier increases the monthly credit allowance at a lower effective per-credit cost, incentivizing subscription upgrades over one-off top-ups.
- Annual subscriptions offer a further discount on the effective monthly credit cost.

### 5.2 Credit Consumption & Expiry Rules

- **Monthly allowance credits** are granted at the start of each billing cycle. Unused monthly credits **roll over** to the next month but **expire after 2 months** (i.e., credits from January are usable through February but expire at the start of March).
- **Top-up credits** are purchased à la carte and are **valid for 1 year** from purchase date.
- **Consumption order:** Monthly allowance credits (oldest first) are consumed **before** top-up credits. This ensures users get maximum value from their subscription before dipping into purchased credits.
- When a user's total available credits (monthly + top-up) reach zero, AI fill generation is blocked. The user is prompted to either top up or upgrade their plan.

### 5.3 Pricing Tiers

| | **Free** | **Pro Monthly** | **Pro Annual** | **Business Monthly** | **Business Annual** |
|---|---|---|---|---|---|
| **Price** | $0 | $14.99/mo | $119.88/yr ($9.99/mo) | $39.99/mo | $359.88/yr ($29.99/mo) |
| **Monthly Credits** | 5 | 60 | 60 | 200 | 200 |
| **Effective $/credit** | — | $0.25 | $0.17 | $0.20 | $0.15 |
| **Max Resolution** | 720p | 1080p | 1080p | 4K | 4K |
| **Max Input Length** | 5 min | 30 min | 30 min | 2 hours | 2 hours |
| **Max Fill Duration** | ≤ 1s gaps | ≤ 5s gaps | ≤ 5s gaps | ≤ 5s gaps | ≤ 5s gaps |
| **Watermark** | Yes | No | No | No | No |
| **Exports** | 3/month | Unlimited | Unlimited | Unlimited | Unlimited |
| **Credit Rollover** | No | Yes (2-month window) | Yes (2-month window) | Yes (2-month window) | Yes (2-month window) |
| **Transcript Editing** | — | ✓ | ✓ | ✓ | ✓ |
| **Multi-Speaker** | — | — | — | ✓ | ✓ |
| **Batch Processing** | — | — | — | ✓ | ✓ |
| **Priority Processing** | — | — | — | ✓ | ✓ |

### 5.4 Top-Up Credit Packs

Top-up credits are available for any user (including free tier) and are processed via Stripe as one-time purchases.

| Pack | Credits | Price | $/credit | Savings vs. smallest pack |
|------|---------|-------|----------|--------------------------|
| Starter | 10 | $4.99 | $0.50 | — |
| Standard | 30 | $11.99 | $0.40 | 20% |
| Value | 75 | $24.99 | $0.33 | 33% |
| Bulk | 200 | $54.99 | $0.27 | 45% |

Top-up credits are always more expensive per-credit than the equivalent subscription tier, creating a natural upgrade incentive. For example, a user regularly buying 60 credits via top-ups would pay ~$24 (2x Standard packs) vs. $14.99 for Pro monthly which includes 60 credits plus all Pro features.

### 5.5 Credit Upgrade Incentives

The pricing structure is designed to nudge users toward higher-value commitments:

- **Free → Pro Monthly:** 12x more credits per month ($0.25/credit vs. no subscription cost)
- **Pro Monthly → Pro Annual:** Same credits, 33% cheaper per credit ($0.25 → $0.17)
- **Pro → Business Monthly:** 3.3x more credits, lower per-credit cost ($0.25 → $0.20), plus 4K/multi-speaker/batch
- **Business Monthly → Business Annual:** Same credits, 25% cheaper per credit ($0.20 → $0.15)
- **Top-Up → Any Subscription:** Subscriptions are always cheaper per-credit than top-ups, with added features

### 5.6 RevenueCat Integration Architecture

RevenueCat serves as the subscription management layer for the web app, providing a single source of truth for entitlements and subscription state. Credit balance tracking is managed by the NoCut backend (not RevenueCat), since RevenueCat handles subscriptions but not consumable credit ledgers. Mobile SDK integration is deferred to Phase 3.

#### 5.6.1 Integration Touchpoints (MVP — Web Only)

- **Subscriptions (RevenueCat + Stripe):** RevenueCat's Web SDK + Stripe billing integration handles recurring subscriptions. Stripe Checkout provides the payment UI. RevenueCat syncs subscription state and triggers credit allocation via webhook.
- **Top-Up Purchases (Stripe Direct):** One-time credit pack purchases are handled directly via Stripe Checkout (not through RevenueCat, which is optimized for subscriptions). On successful payment, the backend credits the user's account.
- **Backend Webhook Listener:** RevenueCat sends webhooks for subscription lifecycle events. Stripe sends webhooks for one-time top-up purchases. Backend processes both to update entitlements and credit balances.
- **Entitlement + Credit Check Middleware:** Every API request that triggers AI generation checks both (a) the user's RevenueCat entitlement for feature access and (b) the user's credit balance for sufficient credits.

**Phase 3 (deferred):**

- **Mobile (iOS/Android):** RevenueCat Purchases SDK for native in-app purchases. Credit balance syncs across platforms via the backend.

#### 5.6.2 Entitlement Model

| Entitlement | Free | Pro | Business |
|-------------|------|-----|----------|
| `ai_fill` | ✓ (≤ 1s gaps, credit-gated) | ✓ (≤ 5s gaps, credit-gated) | ✓ (≤ 5s gaps, credit-gated) |
| `export_video` | ✓ (3/mo, watermarked) | ✓ (unlimited) | ✓ (unlimited) |
| `transcript_edit` | ✗ | ✓ | ✓ |
| `hd_export` | ✗ | ✓ (1080p) | ✓ (4K) |
| `multi_speaker` | ✗ | ✗ | ✓ |
| `batch_processing` | ✗ | ✗ | ✓ |
| `priority_queue` | ✗ | ✗ | ✓ |
| `brand_overlays` | ✗ | ✗ | ✓ |

#### 5.6.3 Credit Ledger (Backend-Managed)

The credit system is tracked in the NoCut backend database, not in RevenueCat:

| Table: `credit_ledger` | Description |
|------------------------|-------------|
| `id` | Unique ledger entry ID |
| `user_id` | Foreign key to users table |
| `type` | `monthly_allowance` or `top_up` |
| `credits_granted` | Number of credits added |
| `credits_remaining` | Current balance for this entry |
| `granted_at` | When credits were issued |
| `expires_at` | Expiry date (2 months for monthly, 1 year for top-up) |
| `stripe_payment_id` | Stripe payment reference (for top-ups) |

**Credit deduction logic (executed atomically):**

1. Query all non-expired ledger entries for the user, ordered by: `type = 'monthly_allowance'` first (then oldest first), then `type = 'top_up'` (oldest first).
2. Deduct the required credits from the first entry with `credits_remaining > 0`.
3. If the first entry doesn't have enough, continue to the next entry until the full amount is covered.
4. If total available credits < required credits, reject the request and prompt upgrade/top-up.

#### 5.6.4 RevenueCat Configuration

**Subscription Products (RevenueCat Dashboard):**

- `nocut_pro_monthly` — $14.99/month (60 credits/month)
- `nocut_pro_annual` — $119.88/year (60 credits/month)
- `nocut_business_monthly` — $39.99/month (200 credits/month)
- `nocut_business_annual` — $359.88/year (200 credits/month)

**Top-Up Products (Stripe Products, not RevenueCat):**

- `nocut_credits_10` — $4.99
- `nocut_credits_30` — $11.99
- `nocut_credits_75` — $24.99
- `nocut_credits_200` — $54.99

**Paywalls:**

- Custom paywall component on web using RevenueCat Web SDK + Stripe Checkout
- Credit balance and usage displayed in the user dashboard
- "Low credits" prompt when balance drops below 5 credits, with upgrade and top-up options
- Native mobile paywalls via RevenueCat Paywalls SDK (deferred to Phase 3)

---

## 6. Technical Constraints & Risks

### 6.1 AI Model Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| AI fill quality insufficient at launch | High — core value prop fails | Medium | Implement graceful fallback (crossfade/morph) for low-confidence fills. Ship with quality threshold; only show AI fill when confidence > 0.85 |
| Deepfake/misuse concerns | High — regulatory, reputational | High | Require same-speaker verification. Embed C2PA provenance metadata. Rate limit generation. Content moderation pipeline |
| GPU cost exceeds revenue at scale | High — unsustainable unit economics | Medium | Tiered processing quality. Aggressive caching of speaker models. Spot instance usage for non-priority queue. Monitor cost-per-export closely |
| Long processing times hurt UX | Medium — user churn | Medium | Show real-time progress. Allow notification on completion. Pre-generate fills during editing session. Background processing with email/push notification |

### 6.2 Platform Constraints

- **Browser Limitations:** WebCodecs API coverage is improving but not universal. Safari support may require fallback to WASM-based decoding.
- **Large File Uploads:** Uploading large video files over unstable connections requires chunked, resumable upload with clear progress feedback.
- **RevenueCat + Stripe Web:** RevenueCat's web/Stripe integration is newer than their mobile SDKs. Plan for edge cases in subscription state management.
- **Lovable Platform Constraints:** Building with Lovable accelerates development but may impose limitations on low-level Canvas/WebGL customization for the timeline editor. Evaluate early and plan escape hatches if needed.

---

## 7. Ethical & Trust Framework

Because NoCut generates synthetic video of real people, a robust ethical framework is non-negotiable and should be a selling point, not an afterthought.

- **Same-Speaker Only:** AI fill is generated exclusively from the uploaded speaker's own footage. The system cannot generate footage of a person from someone else's upload.
- **Identity Verification:** For generated footage exceeding 3 seconds, require the uploader to verify they are the speaker (or have explicit consent).
- **C2PA Provenance:** All exported videos include Content Credentials metadata indicating which segments are AI-generated.
- **No Third-Party Generation:** The platform cannot be used to generate video of people who are not the uploader or an explicitly consenting participant.
- **Audit Log:** Every AI generation event is logged with timestamp, input hash, and output hash for accountability.
- **Transparency Badge:** Optional (but encouraged) visible badge on exported videos indicating AI-assisted editing.

---

## 8. Development Phases & Timeline

| Phase | Duration | Deliverables | Success Criteria |
|-------|----------|-------------|-----------------|
| **Phase 1: MVP** | Weeks 1–8 | Lovable web app, Supabase auth, upload pipeline, basic timeline editor, silence detection, basic export (with jump cuts — no AI fill yet), RevenueCat + Stripe integration, credit system (monthly allowance + top-up purchases + balance dashboard) | Authenticated user can upload, see auto-detected pauses on timeline, make manual cuts, and export. Credit balance tracking and top-up purchase flow working end-to-end |
| **Phase 2: Core AI + Polish** | Weeks 9–18 | AI fill engine v1 (short gaps ≤ 2s), filler word detection, transcript-based editing, one-click accept/reject, keyboard shortcuts, Pro tier launch | AI fills pass quality threshold (≥ 4.0/5.0 user rating). RevenueCat payments live. 500 beta users |
| **Phase 3: Mobile + Scale** | Weeks 19–26 | iOS & Android apps, long AI fills (≤ 5s), repeated segment detection, RevenueCat mobile SDK, cross-platform subscription sync | Mobile capture-to-export workflow. Cross-platform entitlements working. 5,000 MAU |
| **Phase 4: Business Tier** | Weeks 27–34 | Multi-speaker, batch processing, 4K, brand overlays, Business tier launch | Business tier revenue. Batch processing < 2x single video time. 20,000 MAU |
| **Phase 5: Growth** | Weeks 35–44 | Direct social publishing, collaborative editing, API, Enterprise tier | API adoption. Social publishing drives organic growth. 50,000+ MAU |

---

## 9. Success Criteria & KPIs

### 9.1 Launch Criteria (Phase 1 — MVP Complete)

- Supabase auth working end-to-end (sign-up, sign-in, session management, RLS)
- Upload-to-export workflow completes successfully for a 5-minute video
- Silence detection accurately identifies pauses ≥ 1.5s
- Timeline editor supports basic manual cut operations
- RevenueCat + Stripe subscription flow works end-to-end on web
- Credit system operational: monthly allowance granted on subscription, top-up purchase via Stripe, balance deducted on AI fill, correct consumption order (monthly before top-up)
- Zero data loss in upload/processing pipeline over 100 test runs
- Core Web Vitals pass (LCP < 2.5s, FID < 100ms, CLS < 0.1)

### 9.2 Ongoing KPIs

| Category | KPI | Measurement |
|----------|-----|-------------|
| Growth | MAU, DAU, DAU/MAU ratio | Analytics (Amplitude/Mixpanel) |
| Revenue | MRR, ARPU, LTV, churn rate | RevenueCat dashboard + internal analytics |
| Product | Exports per user, AI fill acceptance rate | Internal telemetry |
| Quality | AI fill quality score, export success rate | User ratings + automated QA |
| Performance | Processing time per minute of video | Infrastructure monitoring |
| Support | Ticket volume, resolution time | Support platform metrics |

---

## 10. Open Questions & Decisions Needed

| # | Question | Options | Owner | Due |
|---|----------|---------|-------|-----|
| 1 | AI model: build vs. license? | Build custom model vs. license from provider (e.g., D-ID, HeyGen API, Runway) | Tech Lead | Phase 1 |
| 2 | Free tier AI fill: include or paywall entirely? | ≤ 1s fills on free (current plan) vs. no AI fill on free | Product | Phase 1 |
| 3 | Timeline editor: Lovable-native or external library? | Build within Lovable vs. integrate a dedicated timeline component (e.g., wavesurfer.js + custom Canvas) | Engineering | Phase 1 |
| 4 | Content moderation approach | Automated scanning vs. manual review vs. hybrid | Trust & Safety | Phase 2 |
| 5 | RevenueCat vs. building subscription infra | RevenueCat handles complexity but adds dependency. Evaluate at scale | Engineering | Phase 3 |
| 6 | When to introduce mobile apps? | After web MVP is validated (Phase 3) vs. earlier if demand warrants | Product | Phase 2 |

---

## Appendix A: Glossary

| Term | Definition |
|------|-----------|
| **AI Fill** | Synthetically generated video footage of the speaker used to bridge gaps created by removing unwanted segments |
| **Credit** | The unit of currency for AI fill generation. 1 credit = 1 second of generated footage. Granted monthly via subscription or purchased as top-ups |
| **Cut Point** | A location in the timeline where a segment begins or ends for removal |
| **Entitlement** | A RevenueCat concept representing a feature or capability a user has access to based on their subscription |
| **Gap** | The space in the timeline after a segment has been removed, which needs to be bridged |
| **One-Take** | A video that appears to have been recorded continuously without any stops, edits, or retakes |
| **Proxy** | A lower-resolution version of the video used for timeline editing performance |
| **Speaker Model** | The AI's learned representation of a speaker's face, mannerisms, and appearance from existing footage |
| **Top-Up** | A one-time credit purchase (not a subscription). Top-up credits are valid for 1 year and consumed after monthly allowance credits |
| **C2PA** | Coalition for Content Provenance and Authenticity — an open standard for content credentials and provenance metadata |
