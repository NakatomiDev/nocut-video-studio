# NoCut — API Reference

**Version:** 1.0
**Date:** March 2026
**Status:** Draft (Aligned with PRD v1.2 & Architecture v2.0)
**Classification:** Confidential

---

## Table of Contents

- [1. Overview](#1-overview)
- [2. Authentication](#2-authentication)
- [3. Common Patterns](#3-common-patterns)
- [4. Upload API](#4-upload-api)
- [5. Projects API](#5-projects-api)
- [6. Editor API](#6-editor-api)
- [7. Export API](#7-export-api)
- [8. Credits API](#8-credits-api)
- [9. User API](#9-user-api)
- [10. Webhooks](#10-webhooks)
- [11. Realtime Subscriptions](#11-realtime-subscriptions)
- [12. Error Reference](#12-error-reference)
- [13. Rate Limits](#13-rate-limits)
- [14. Data Models](#14-data-models)

---

## 1. Overview

### 1.1 Base URL

All API endpoints are Supabase Edge Functions:

```
https://<project-ref>.supabase.co/functions/v1
```

For Supabase database queries (via PostgREST):

```
https://<project-ref>.supabase.co/rest/v1
```

For Supabase Realtime:

```
wss://<project-ref>.supabase.co/realtime/v1
```

### 1.2 Content Type

All requests and responses use JSON:

```
Content-Type: application/json
```

### 1.3 API Versioning

The API is currently unversioned (v1 implied). When breaking changes are needed, a version prefix will be added to Edge Function paths (e.g., `/functions/v1/v2/upload/initiate`).

---

## 2. Authentication

All API requests require a valid Supabase Auth JWT token in the `Authorization` header.

```
Authorization: Bearer <supabase_access_token>
```

### 2.1 Obtaining a Token

Tokens are obtained via Supabase Auth (handled by the Supabase JS client in the Lovable app):

```typescript
// Sign up
const { data, error } = await supabase.auth.signUp({
  email: 'user@example.com',
  password: 'securepassword',
});

// Sign in
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'securepassword',
});

// OAuth (Google)
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
});

// Get current session token
const { data: { session } } = await supabase.auth.getSession();
const token = session?.access_token;
```

### 2.2 Token Lifecycle

- Access tokens expire after **1 hour**
- Refresh tokens are rotated automatically by the Supabase JS client
- On token expiry, the client silently refreshes — no user action needed
- If the refresh token is also expired, the user is redirected to sign in

### 2.3 Unauthenticated Requests

All requests without a valid token receive:

```json
{
  "error": "unauthorized",
  "message": "Missing or invalid authentication token",
  "status": 401
}
```

---

## 3. Common Patterns

### 3.1 Response Envelope

All Edge Function responses follow a consistent structure:

**Success:**

```json
{
  "data": { ... },
  "meta": {
    "request_id": "uuid",
    "timestamp": "2026-03-21T12:00:00Z"
  }
}
```

**Error:**

```json
{
  "error": {
    "code": "insufficient_credits",
    "message": "You need 5 credits but only have 3 available",
    "details": { ... }
  },
  "meta": {
    "request_id": "uuid",
    "timestamp": "2026-03-21T12:00:00Z"
  }
}
```

### 3.2 Pagination

List endpoints use cursor-based pagination:

```
GET /rest/v1/projects?order=created_at.desc&limit=20&offset=0
```

### 3.3 Idempotency

Mutating endpoints (POST, PUT, DELETE) accept an optional `Idempotency-Key` header to prevent duplicate operations:

```
Idempotency-Key: <client-generated-uuid>
```

---

## 4. Upload API

### 4.1 Initiate Upload

Validates the file and returns presigned S3 URLs for chunked upload.

```
POST /functions/v1/upload/initiate
```

**Request:**

```json
{
  "filename": "recording.mp4",
  "file_size_bytes": 524288000,
  "mime_type": "video/mp4",
  "duration_seconds": 300,
  "resolution": "1920x1080",
  "title": "My Video"
}
```

**Response (200):**

```json
{
  "data": {
    "project_id": "uuid",
    "video_id": "uuid",
    "upload_session_id": "uuid",
    "chunk_size_bytes": 5242880,
    "total_chunks": 100,
    "presigned_urls": [
      {
        "chunk_index": 0,
        "url": "https://s3.amazonaws.com/nocut-uploads/...",
        "expires_at": "2026-03-21T13:00:00Z"
      }
    ]
  }
}
```

**Errors:**

| Code | Status | Condition |
|------|--------|-----------|
| `file_too_large` | 413 | File exceeds tier limit (4GB free, 10GB pro, 25GB business) |
| `duration_exceeded` | 413 | Duration exceeds tier limit (5min free, 30min pro, 2hr business) |
| `unsupported_format` | 415 | File type not in supported list (MP4, MOV, WebM, MKV) |
| `resolution_exceeded` | 413 | Resolution exceeds tier limit (1080p free/pro, 4K business) |

### 4.2 Report Chunk Complete

Called by the client after each chunk is uploaded directly to S3.

```
POST /functions/v1/upload/chunk-complete
```

**Request:**

```json
{
  "upload_session_id": "uuid",
  "chunk_index": 0,
  "etag": "\"abc123\""
}
```

**Response (200):**

```json
{
  "data": {
    "chunks_completed": 1,
    "chunks_total": 100,
    "progress_percent": 1
  }
}
```

### 4.3 Complete Upload

Called after all chunks are reported complete. Triggers assembly and transcoding.

```
POST /functions/v1/upload/complete
```

**Request:**

```json
{
  "upload_session_id": "uuid"
}
```

**Response (200):**

```json
{
  "data": {
    "project_id": "uuid",
    "video_id": "uuid",
    "status": "transcoding",
    "estimated_processing_seconds": 120
  }
}
```

The client should subscribe to Realtime updates for the project to track transcoding and detection progress (see Section 11).

---

## 5. Projects API

### 5.1 List Projects

```
GET /rest/v1/projects?select=*&order=created_at.desc&limit=20&offset=0
```

**Response (200):**

```json
[
  {
    "id": "uuid",
    "user_id": "uuid",
    "title": "My Video",
    "status": "ready",
    "created_at": "2026-03-21T12:00:00Z",
    "updated_at": "2026-03-21T12:05:00Z"
  }
]
```

**Project Status Values:**

| Status | Description |
|--------|-------------|
| `uploading` | Chunks being uploaded |
| `transcoding` | FFmpeg transcoding + proxy generation |
| `detecting` | Silence/filler detection running |
| `ready` | Ready for editing |
| `generating` | AI fill generation in progress |
| `exporting` | Final video assembly in progress |
| `complete` | Export complete, video available |
| `failed` | Processing failed (see error details) |

### 5.2 Get Project

```
GET /rest/v1/projects?id=eq.<project_id>&select=*,videos(*),exports(*)
```

**Response (200):**

```json
{
  "id": "uuid",
  "user_id": "uuid",
  "title": "My Video",
  "status": "ready",
  "created_at": "2026-03-21T12:00:00Z",
  "videos": [
    {
      "id": "uuid",
      "duration": 300.5,
      "resolution": "1920x1080",
      "format": "mp4",
      "proxy_url": "https://cdn.nocut.app/proxy/..."
    }
  ],
  "exports": []
}
```

### 5.3 Update Project

```
PATCH /rest/v1/projects?id=eq.<project_id>
```

**Request:**

```json
{
  "title": "Updated Title"
}
```

### 5.4 Delete Project

```
DELETE /rest/v1/projects?id=eq.<project_id>
```

Deleting a project triggers cleanup of all associated S3 assets (source video, proxy, thumbnails, AI fills, exports). This is handled asynchronously.

---

## 6. Editor API

### 6.1 Get Cut Map

Returns the auto-detected cut map for the timeline editor.

```
GET /functions/v1/projects/<project_id>/cut-map
```

**Response (200):**

```json
{
  "data": {
    "video_id": "uuid",
    "version": 1,
    "duration": 300.5,
    "transcript": {
      "words": [
        {
          "word": "Hello",
          "start": 0.5,
          "end": 0.85,
          "confidence": 0.97
        }
      ],
      "language": "en"
    },
    "cuts": [
      {
        "id": "cut_001",
        "type": "silence",
        "start": 12.34,
        "end": 15.67,
        "duration": 3.33,
        "confidence": 0.92,
        "auto_accept": true,
        "metadata": {
          "avg_rms_db": -52.3
        }
      }
    ],
    "waveform_url": "https://cdn.nocut.app/waveform/...",
    "thumbnail_sprite_url": "https://cdn.nocut.app/thumbnails/...",
    "proxy_video_url": "https://cdn.nocut.app/proxy/..."
  }
}
```

### 6.2 Submit Edit Decision List (EDL)

Submits the user's final edit decisions. Triggers credit check, deduction, and AI fill generation.

```
POST /functions/v1/projects/<project_id>/edl
```

**Request:**

```json
{
  "gaps": [
    {
      "pre_cut_timestamp": 12.34,
      "post_cut_timestamp": 15.67,
      "fill_method": "ai_fill",
      "estimated_fill_duration": 1.5
    },
    {
      "pre_cut_timestamp": 45.00,
      "post_cut_timestamp": 47.50,
      "fill_method": "ai_fill",
      "estimated_fill_duration": 1.0
    }
  ],
  "output_format": "mp4",
  "output_resolution": "1080p"
}
```

**Response (200):**

```json
{
  "data": {
    "edit_decision_id": "uuid",
    "status": "generating",
    "credits_charged": 3,
    "credits_remaining": 57,
    "estimated_processing_seconds": 180,
    "gaps": [
      {
        "gap_index": 0,
        "fill_method": "ai_fill",
        "estimated_fill_duration": 1.5,
        "credits_cost": 2
      },
      {
        "gap_index": 1,
        "fill_method": "ai_fill",
        "estimated_fill_duration": 1.0,
        "credits_cost": 1
      }
    ]
  }
}
```

**Errors:**

| Code | Status | Condition |
|------|--------|-----------|
| `insufficient_credits` | 402 | Not enough credits. Response includes `available`, `required`, and `topup_url`. |
| `entitlement_required` | 403 | User doesn't have `ai_fill` entitlement or gap exceeds tier's max fill duration. |
| `export_limit_reached` | 403 | Free tier user has used 3 exports this month. |
| `resolution_not_available` | 403 | Requested resolution exceeds tier (e.g., 4K on Pro). |

**Insufficient Credits Response (402):**

```json
{
  "error": {
    "code": "insufficient_credits",
    "message": "You need 5 credits but only have 3 available",
    "details": {
      "credits_available": 3,
      "credits_required": 5,
      "topup_options": [
        { "product_id": "nocut_credits_10", "credits": 10, "price": "$4.99" },
        { "product_id": "nocut_credits_30", "credits": 30, "price": "$11.99" }
      ],
      "upgrade_url": "https://app.nocut.app/upgrade"
    }
  }
}
```

### 6.3 Get Credit Estimate

Returns the estimated credit cost for a set of edits without committing.

```
POST /functions/v1/projects/<project_id>/estimate
```

**Request:**

```json
{
  "gaps": [
    { "pre_cut_timestamp": 12.34, "post_cut_timestamp": 15.67 },
    { "pre_cut_timestamp": 45.00, "post_cut_timestamp": 47.50 }
  ]
}
```

**Response (200):**

```json
{
  "data": {
    "total_credits_required": 3,
    "credits_available": 57,
    "sufficient": true,
    "gap_estimates": [
      { "gap_index": 0, "estimated_fill_duration": 1.5, "credits": 2 },
      { "gap_index": 1, "estimated_fill_duration": 1.0, "credits": 1 }
    ]
  }
}
```

---

## 7. Export API

### 7.1 Get Export Status

```
GET /functions/v1/exports/<export_id>/status
```

**Response (200):**

```json
{
  "data": {
    "export_id": "uuid",
    "project_id": "uuid",
    "status": "complete",
    "progress_percent": 100,
    "format": "mp4",
    "resolution": "1080p",
    "duration": 285.3,
    "file_size_bytes": 157286400,
    "watermarked": false,
    "c2pa_signed": true,
    "download_url": "https://cdn.nocut.app/exports/...",
    "download_url_expires_at": "2026-03-21T13:00:00Z",
    "created_at": "2026-03-21T12:00:00Z",
    "completed_at": "2026-03-21T12:03:00Z",
    "fill_summary": {
      "total_gaps": 12,
      "ai_fills": 10,
      "crossfades": 1,
      "hard_cuts": 1,
      "credits_used": 10,
      "credits_refunded": 2
    }
  }
}
```

**Export Status Values:**

| Status | Description |
|--------|-------------|
| `queued` | Waiting in export queue |
| `generating` | AI fill generation in progress |
| `assembling` | FFmpeg assembling final video |
| `encoding` | Encoding to output format |
| `signing` | Applying C2PA metadata |
| `uploading` | Uploading to CDN |
| `complete` | Ready for download |
| `failed` | Export failed (see error details) |

### 7.2 List Exports

```
GET /rest/v1/exports?project_id=eq.<project_id>&select=*&order=created_at.desc
```

### 7.3 Get Download URL

Returns a fresh signed download URL for an export.

```
GET /functions/v1/exports/<export_id>/download
```

**Response (200):**

```json
{
  "data": {
    "download_url": "https://cdn.nocut.app/exports/...",
    "expires_at": "2026-03-21T13:00:00Z",
    "filename": "my-video-nocut.mp4"
  }
}
```

---

## 8. Credits API

### 8.1 Get Credit Balance

```
GET /functions/v1/credits/balance
```

**Response (200):**

```json
{
  "data": {
    "total": 62,
    "monthly": 57,
    "topup": 5,
    "breakdown": [
      {
        "type": "monthly_allowance",
        "credits_remaining": 42,
        "granted_at": "2026-03-01T00:00:00Z",
        "expires_at": "2026-05-01T00:00:00Z"
      },
      {
        "type": "monthly_allowance",
        "credits_remaining": 15,
        "granted_at": "2026-02-01T00:00:00Z",
        "expires_at": "2026-04-01T00:00:00Z"
      },
      {
        "type": "top_up",
        "credits_remaining": 5,
        "granted_at": "2026-01-15T00:00:00Z",
        "expires_at": "2027-01-15T00:00:00Z"
      }
    ]
  }
}
```

### 8.2 Get Credit History

```
GET /functions/v1/credits/history?limit=20&offset=0
```

**Response (200):**

```json
{
  "data": {
    "transactions": [
      {
        "id": "uuid",
        "type": "deduction",
        "credits": 3,
        "reason": "ai_fill",
        "project_id": "uuid",
        "project_title": "My Video",
        "created_at": "2026-03-21T12:00:00Z"
      },
      {
        "id": "uuid",
        "type": "refund",
        "credits": 1,
        "reason": "refund_failed_fill",
        "project_id": "uuid",
        "project_title": "My Video",
        "created_at": "2026-03-21T12:03:00Z"
      },
      {
        "id": "uuid",
        "type": "allocation",
        "credits": 60,
        "reason": "monthly_allowance_pro",
        "created_at": "2026-03-01T00:00:00Z"
      }
    ],
    "total_count": 45
  }
}
```

### 8.3 Create Top-Up Checkout Session

Creates a Stripe Checkout session for purchasing a credit pack.

```
POST /functions/v1/credits/topup
```

**Request:**

```json
{
  "product_id": "nocut_credits_30"
}
```

**Response (200):**

```json
{
  "data": {
    "checkout_url": "https://checkout.stripe.com/c/pay/...",
    "session_id": "cs_live_...",
    "credits": 30,
    "price": "$11.99"
  }
}
```

**Valid Product IDs:**

| Product ID | Credits | Price |
|-----------|---------|-------|
| `nocut_credits_10` | 10 | $4.99 |
| `nocut_credits_30` | 30 | $11.99 |
| `nocut_credits_75` | 75 | $24.99 |
| `nocut_credits_200` | 200 | $54.99 |

---

## 9. User API

### 9.1 Get Current User

```
GET /functions/v1/user/me
```

**Response (200):**

```json
{
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "tier": "pro",
    "subscription": {
      "product_id": "nocut_pro_monthly",
      "status": "active",
      "current_period_end": "2026-04-21T00:00:00Z",
      "cancel_at_period_end": false,
      "management_url": "https://billing.revenuecat.com/..."
    },
    "credits": {
      "total": 62,
      "monthly": 57,
      "topup": 5
    },
    "usage_this_month": {
      "exports_count": 7,
      "ai_fills_count": 23,
      "credits_used": 34
    },
    "limits": {
      "max_file_size_gb": 10,
      "max_duration_minutes": 30,
      "max_resolution": "1080p",
      "max_fill_duration_seconds": 5,
      "exports_per_month": null,
      "watermark": false
    },
    "created_at": "2026-01-15T00:00:00Z"
  }
}
```

### 9.2 Get Tier Limits

Returns the feature limits for any tier (useful for paywall/upgrade prompts).

```
GET /functions/v1/user/tier-limits?tier=pro
```

**Response (200):**

```json
{
  "data": {
    "tier": "pro",
    "limits": {
      "max_file_size_gb": 10,
      "max_duration_minutes": 30,
      "max_resolution": "1080p",
      "max_fill_duration_seconds": 5,
      "monthly_credits": 60,
      "exports_per_month": null,
      "watermark": false,
      "transcript_edit": true,
      "multi_speaker": false,
      "batch_processing": false,
      "priority_queue": false
    },
    "price": {
      "monthly": "$14.99",
      "annual": "$119.88",
      "annual_effective_monthly": "$9.99"
    }
  }
}
```

---

## 10. Webhooks

NoCut receives webhooks from two sources. These endpoints are not called by the client app — they are called by RevenueCat and Stripe.

### 10.1 RevenueCat Webhook

```
POST /functions/v1/webhooks/revenuecat
```

**Authentication:** `Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>`

**Handled Events:**

| Event Type | Action |
|-----------|--------|
| `INITIAL_PURCHASE` | Update user tier. Allocate monthly credits. |
| `RENEWAL` | Allocate monthly credits for new billing period. |
| `PRODUCT_CHANGE` | Update tier. Allocate prorated credits. |
| `CANCELLATION` | Mark subscription as cancelling. Trigger retention flow. |
| `UNCANCELLATION` | Clear cancellation flag. |
| `EXPIRATION` | Downgrade to free tier. Allocate 5 free credits. |
| `BILLING_ISSUE` | Flag account. Send billing reminder. |

### 10.2 Stripe Webhook

```
POST /functions/v1/webhooks/stripe
```

**Authentication:** Stripe signature verification via `stripe-signature` header.

**Handled Events:**

| Event Type | Action |
|-----------|--------|
| `checkout.session.completed` | Allocate top-up credits based on product ID in session metadata. |
| `charge.refunded` | Deduct refunded credits from ledger. Flag for review if already consumed. |

---

## 11. Realtime Subscriptions

The Lovable app subscribes to Supabase Realtime channels for live progress updates. These are not HTTP endpoints — they use WebSocket connections via the Supabase JS client.

### 11.1 Project Status Updates

Subscribe to changes on the `projects` table for live status updates:

```typescript
const channel = supabase
  .channel('project-status')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'projects',
    filter: `id=eq.${projectId}`,
  }, (payload) => {
    // payload.new.status: 'transcoding' | 'detecting' | 'ready' | etc.
    updateProjectStatus(payload.new.status);
  })
  .subscribe();
```

### 11.2 Job Progress Updates

Subscribe to the `job_queue` table for granular progress on async jobs:

```typescript
const channel = supabase
  .channel('job-progress')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'job_queue',
    filter: `project_id=eq.${projectId}`,
  }, (payload) => {
    // payload.new.status: 'processing' | 'complete' | 'failed'
    // payload.new.progress_percent: 0-100
    // payload.new.type: 'video.transcode' | 'video.detect' | 'ai.fill' | 'video.export'
    updateJobProgress(payload.new);
  })
  .subscribe();
```

### 11.3 Credit Balance Updates

Subscribe to credit balance changes (triggered by allocations, deductions, refunds):

```typescript
const channel = supabase
  .channel('credit-updates')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'credit_transactions',
    filter: `user_id=eq.${userId}`,
  }, (payload) => {
    // Refresh credit balance display
    refreshCreditBalance();
  })
  .subscribe();
```

---

## 12. Error Reference

### 12.1 Standard Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `unauthorized` | 401 | Missing or invalid authentication token |
| `forbidden` | 403 | Authenticated but not authorized for this resource |
| `not_found` | 404 | Resource does not exist or is not owned by the user |
| `validation_error` | 400 | Request body failed validation |
| `rate_limited` | 429 | Too many requests (see Section 13) |
| `internal_error` | 500 | Unexpected server error |

### 12.2 Business Logic Error Codes

| Code | HTTP Status | Description | Client Action |
|------|-------------|-------------|---------------|
| `insufficient_credits` | 402 | User doesn't have enough credits for the operation | Show top-up prompt with `topup_options` from response |
| `entitlement_required` | 403 | User's tier doesn't include the required feature | Show upgrade prompt with `upgrade_url` from response |
| `export_limit_reached` | 403 | Free tier user has exhausted monthly export limit | Show upgrade prompt |
| `file_too_large` | 413 | Upload file exceeds tier's max file size | Show tier limits and upgrade option |
| `duration_exceeded` | 413 | Video duration exceeds tier's max input length | Show tier limits and upgrade option |
| `resolution_exceeded` | 413 | Video resolution exceeds tier's max resolution | Show tier limits and upgrade option |
| `unsupported_format` | 415 | File format not supported | Show supported formats list |
| `fill_duration_exceeded` | 403 | A single gap exceeds the tier's max fill duration | Suggest splitting the gap or upgrading |
| `project_not_ready` | 409 | Project is still processing (transcoding/detecting) | Wait and retry, or subscribe to Realtime |
| `upload_session_expired` | 410 | Upload session has expired (presigned URLs no longer valid) | Re-initiate upload |
| `generation_failed` | 500 | AI fill generation failed after all retries | Credits auto-refunded; user can retry |

### 12.3 Error Response Structure

All errors include enough context for the client to present a helpful message and take action:

```json
{
  "error": {
    "code": "insufficient_credits",
    "message": "Human-readable message for display",
    "details": {
      "credits_available": 3,
      "credits_required": 5,
      "topup_options": [...],
      "upgrade_url": "..."
    }
  },
  "meta": {
    "request_id": "uuid",
    "timestamp": "2026-03-21T12:00:00Z"
  }
}
```

---

## 13. Rate Limits

Rate limits are enforced per authenticated user and are tier-based.

### 13.1 API Rate Limits

| Tier | Requests/second | Burst (10s window) |
|------|----------------|-------------------|
| Free | 10 | 50 |
| Pro | 50 | 200 |
| Business | 200 | 800 |

### 13.2 AI Generation Rate Limits

| Tier | Max fills/hour | Max total fill seconds/video |
|------|---------------|------------------------------|
| Free | 5 | 10 |
| Pro | 50 | 60 |
| Business | 200 | 300 |

### 13.3 Rate Limit Response

When rate limited, the API returns:

```
HTTP 429 Too Many Requests
```

```json
{
  "error": {
    "code": "rate_limited",
    "message": "Rate limit exceeded. Try again in 3 seconds.",
    "details": {
      "limit": 10,
      "window": "1s",
      "retry_after_seconds": 3
    }
  }
}
```

**Headers:**

```
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1679400003
Retry-After: 3
```

---

## 14. Data Models

### 14.1 User

```json
{
  "id": "uuid",
  "email": "string",
  "supabase_uid": "uuid",
  "revenuecat_id": "string",
  "tier": "free | pro | business",
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### 14.2 Project

```json
{
  "id": "uuid",
  "user_id": "uuid",
  "title": "string",
  "status": "uploading | transcoding | detecting | ready | generating | exporting | complete | failed",
  "error_message": "string | null",
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### 14.3 Video

```json
{
  "id": "uuid",
  "project_id": "uuid",
  "s3_key": "string",
  "duration": "float (seconds)",
  "resolution": "string (e.g., '1920x1080')",
  "format": "string (e.g., 'mp4')",
  "file_size_bytes": "integer",
  "proxy_s3_key": "string",
  "waveform_s3_key": "string",
  "thumbnail_sprite_s3_key": "string",
  "created_at": "timestamp"
}
```

### 14.4 Cut Map

```json
{
  "id": "uuid",
  "video_id": "uuid",
  "version": "integer",
  "cuts_json": "CutMap object (see Section 6.1)",
  "transcript_json": "Transcript object | null",
  "created_at": "timestamp"
}
```

### 14.5 Edit Decision

```json
{
  "id": "uuid",
  "project_id": "uuid",
  "edl_json": "EDL object (see Section 6.2)",
  "total_fill_seconds": "float",
  "credits_charged": "integer",
  "status": "pending | generating | exporting | complete | failed",
  "created_at": "timestamp"
}
```

### 14.6 AI Fill

```json
{
  "id": "uuid",
  "edit_decision_id": "uuid",
  "gap_index": "integer",
  "s3_key": "string",
  "method": "ai_fill | crossfade | hard_cut",
  "provider": "did | heygen | veo | custom | null",
  "quality_score": "float (0-1) | null",
  "duration": "float (seconds)",
  "generation_time_ms": "integer",
  "created_at": "timestamp"
}
```

### 14.7 Export

```json
{
  "id": "uuid",
  "project_id": "uuid",
  "edit_decision_id": "uuid",
  "s3_key": "string",
  "format": "string (e.g., 'mp4')",
  "resolution": "string (e.g., '1920x1080')",
  "duration": "float (seconds)",
  "file_size_bytes": "integer",
  "watermarked": "boolean",
  "c2pa_signed": "boolean",
  "fill_summary_json": "FillSummary object (see Section 7.1)",
  "created_at": "timestamp"
}
```

### 14.8 Credit Ledger Entry

```json
{
  "id": "uuid",
  "user_id": "uuid",
  "type": "monthly_allowance | top_up",
  "credits_granted": "integer",
  "credits_remaining": "integer",
  "granted_at": "timestamp",
  "expires_at": "timestamp",
  "stripe_payment_id": "string | null",
  "revenuecat_event_id": "string | null"
}
```

### 14.9 Credit Transaction

```json
{
  "id": "uuid",
  "user_id": "uuid",
  "project_id": "uuid | null",
  "type": "deduction | refund | allocation",
  "credits": "integer",
  "ledger_entries": "[{ledger_id, amount}]",
  "reason": "string (e.g., 'ai_fill', 'refund_failed_fill', 'monthly_allowance_pro', 'topup_purchase')",
  "created_at": "timestamp"
}
```

### 14.10 Job Queue Entry

```json
{
  "id": "uuid",
  "project_id": "uuid",
  "type": "video.transcode | video.detect | ai.fill | video.export",
  "payload": "JSON object",
  "status": "queued | processing | complete | failed | dead_letter",
  "priority": "integer (1 = highest)",
  "progress_percent": "integer (0-100)",
  "attempts": "integer",
  "error_message": "string | null",
  "created_at": "timestamp",
  "started_at": "timestamp | null",
  "completed_at": "timestamp | null"
}
```
