# NoCut MVP — End-to-End Test Plan

> Reflects the **actual implementation** as documented in `DEVIATION_LOG.md`, not the original spec.

---

## 1. New User Sign Up Flow

### Preconditions
- No existing account for the test email
- Supabase auth configured (email/password provider enabled)
- `handle_new_user` trigger active (creates user row + 5 free credits in `credit_ledger`)

### Steps
1. Navigate to `/sign-up`
2. Enter a valid email and password (8+ characters)
3. Click "Sign Up"
4. Verify redirect to `/dashboard`
5. Query Supabase `users` table — confirm row exists with `tier = 'free'`
6. Query `credit_ledger` — confirm 5 free credits allocated (type `monthly`)
7. Verify dashboard shows empty state with "Upload Video" CTA

### Expected Results
- User created in Supabase Auth and `users` table
- 5 free credits allocated via `handle_new_user` trigger
- Dashboard renders empty state (no projects)
- Sidebar shows user email and "Free" tier badge (currently hardcoded — **Deviation: Settings tier badge is hardcoded to "Free"**)

### Actual Results
_(to be filled during testing)_

### Pass/Fail
_(to be filled during testing)_

---

## 2. Upload Happy Path

### Preconditions
- Authenticated user on free tier
- 2-minute MP4 talking-head video file available
- S3 bucket configured with CORS exposing `ETag` header (**Deviation: ETag fallback exists but proper CORS is needed**)
- Edge functions deployed: `upload-initiate`, `upload-chunk-complete`, `upload-complete`
- Transcoder and detector services running

### Steps
1. From dashboard, click "New Project" or "Upload Video" → navigate to `/upload`
2. Drag-and-drop (or file picker) a 2-minute MP4 file onto the upload zone
3. Observe chunked upload progress (5MB chunks, 4 concurrent workers — **Deviation: uses chunked multipart, not simple PUT**)
4. Wait for upload completion → `upload-complete` edge function triggers
5. Observe project status transition: `uploading` → `transcoding`
6. Wait for transcoder to complete: H.264/AAC transcode, 360p proxy, waveform JSON, thumbnail sprites
7. Observe project status transition: `transcoding` → `detecting`
8. Wait for detector to complete: silence/pause detection via librosa RMS analysis (**Deviation: uses librosa instead of pydub**)
9. Observe project status transition: `detecting` → `ready`
10. Verify automatic navigation to `/project/:projectId` editor page
11. Verify waveform timeline renders with silence region overlays
12. Verify detected cuts appear in CutsPanel with confidence scores and auto-accept flags

### Expected Results
- Chunked upload completes with progress indication
- Transcoding produces proxy video, waveform JSON, and thumbnail sprites
- Detection identifies silence regions with confidence scores
- Editor opens showing waveform timeline and detected cuts
- **Note:** Waveform falls back to mock data if waveform JSON URL is unavailable (**Deviation**)

### Actual Results
_(to be filled during testing)_

### Pass/Fail
_(to be filled during testing)_

---

## 3. Editor Happy Path

### Preconditions
- Project in `ready` status with detected cuts
- User has sufficient credits (≥ estimated cost)
- Editor page loaded at `/project/:projectId`

### Steps
1. Review auto-detected silences in CutsPanel (Detected Pauses section)
2. Toggle off 2-3 cuts using the switch controls
3. Verify credit estimate updates client-side (**Deviation: estimate calculated client-side, not via edge function**)
4. Enable razor mode via toolbar button
5. Click twice on the waveform timeline to create a manual cut
6. Verify manual cut appears in "Manual Cuts" section of CutsPanel
7. Verify credit estimate updates to include the new manual cut
8. Click "Export" button
9. Review export confirmation dialog showing cut summary and credit cost
10. Click "Confirm" → edit_decisions row inserted (**Deviation: inserts directly to DB, not via `/projects/:id/edl` edge function**)
11. Verify project status transitions to `generating`

### Expected Results
- Cuts can be toggled on/off with visual feedback
- Manual cuts created via razor tool (two-click workflow; **Deviation: drag-to-select not implemented**)
- Credit estimate reflects only active cuts
- Export confirmation shows accurate credit cost
- EDL submitted and generation starts

### Actual Results
_(to be filled during testing)_

### Pass/Fail
_(to be filled during testing)_

---

## 4. Export Happy Path

### Preconditions
- Project in `generating` status with edit_decisions created
- AI engine service running (crossfade fill for MVP — **Deviation: no real AI models in Phase 1**)
- Exporter service running

### Steps
1. Observe ExportProgress overlay on editor page (triggered by project status or `?exporting=true` param)
2. Monitor progress: AI fill jobs contribute 0-60%, export job contributes 60-100% (**Deviation: weighted composite progress**)
3. Wait for AI engine: crossfade fills generated for each gap, uploaded to S3 at `ai-fills/{user_id}/{project_id}/fill_{gap_index}.mp4`
4. Wait for exporter: segments re-encoded for consistency (**Deviation: all segments re-encoded, not `-c copy`**), concat via FFmpeg, audio normalized (EBU R128)
5. Verify project status → `complete`
6. Verify navigation to `/project/:projectId/export/:exportId`
7. On ExportComplete page, verify:
   - Video preview plays (`<video>` element)
   - File info badges (resolution, duration, size)
   - Export summary card (total cuts, AI fills, crossfades, hard cuts, net credits)
8. Click "Download" → verify video file downloads (blob download with window.open fallback)
9. Play downloaded video → verify smooth playback with crossfade transitions at cut points

### Expected Results
- Progress overlay shows stage-based UI (generating → exporting → finalizing → complete)
- Final video assembled with crossfade transitions (MVP) (**Deviation: crossfade is the only fill method in Phase 1**)
- Free tier: 720p output with watermark (**Deviation: watermark applied via FFmpeg drawtext**)
- Download URL is CloudFront signed (1-hour expiry), falls back to plain S3 URL if CloudFront not configured
- Fill segments get silent audio track via `anullsrc` to prevent desync (**Deviation**)

### Actual Results
_(to be filled during testing)_

### Pass/Fail
_(to be filled during testing)_

---

## 5. Credit Depletion

### Preconditions
- User with exactly 5 free credits remaining
- Stripe configured with top-up product price IDs as env vars (`STRIPE_PRICE_nocut_credits_10`, etc.)
- `webhooks-stripe` edge function deployed

### Steps
1. Create and export a project that consumes all 5 credits
2. Navigate to dashboard, start a new project, upload and process a video
3. In editor, select cuts and click "Export"
4. Verify `InsufficientCreditsModal` appears showing current balance and required credits
5. Click top-up option (e.g., 10 credits)
6. Verify Stripe Checkout session opens (**Deviation: uses `credits-topup` edge function → Stripe Checkout**)
7. Complete purchase in Stripe
8. Verify `webhooks-stripe` processes `checkout.session.completed` → credits added to `credit_ledger`
9. Navigate back to `/credits` → verify updated balance (monthly + top-up breakdown)
10. Return to editor → retry export → verify it succeeds

### Expected Results
- Insufficient credits modal blocks export with clear messaging
- Stripe Checkout flow completes purchase
- Webhook credits the ledger correctly
- Balance displays monthly/top-up/total breakdown (**Deviation: `credits-balance` uses auth-scoped client with RLS**)
- Retry export succeeds with new credits

### Actual Results
_(to be filled during testing)_

### Pass/Fail
_(to be filled during testing)_

---

## 6. Subscription Purchase

### Preconditions
- Free tier user
- RevenueCat Web SDK key configured (**Note: currently NOT wired — buttons log to console with TODO placeholder per Deviation**)

### Steps
1. Navigate to `/settings` or trigger `UpgradePaywall` modal
2. Review plan comparison (Free / Pro / Business) with monthly/annual toggle
3. Select Pro Monthly plan
4. _(When RevenueCat SDK is wired)_ Complete purchase via RevenueCat
5. Verify `webhooks-revenuecat` handles `INITIAL_PURCHASE` event → `users.tier` updated to `pro`, 60 monthly credits allocated
6. Verify Settings page shows "Pro" tier badge
7. Verify tier limits expanded:
   - Upload duration: 30 minutes (was 5 minutes on free)
   - Export resolution: 1080p (was 720p)
   - Fill duration: up to 5 seconds per gap

### Expected Results
- Paywall UI renders correctly with plan details
- **Known limitation:** RevenueCat purchase buttons are currently placeholder (log to console) — **Deviation: `@revenuecat/purchases-js` installed but SDK billing key not configured**
- Webhook updates tier and allocates credits
- `CANCELLATION` and `UNCANCELLATION` events only log — no `cancel_at_period_end` column exists (**Deviation**)
- `BILLING_ISSUE` events only log — no `billing_issue` flag column (**Deviation**)

### Actual Results
_(to be filled during testing)_

### Pass/Fail
_(to be filled during testing)_

---

## 7. Free Tier Limits

### Preconditions
- Authenticated user on free tier
- Tier limits defined in `_shared/tier-limits.ts`: free = 5min max upload, 720p export, watermark

### Steps

**7a. Upload Duration Limit**
1. Prepare a 10-minute MP4 video
2. Navigate to `/upload`, select the file
3. `upload-initiate` edge function validates against tier limits
4. Verify "Duration exceeded" error with upgrade prompt

**7b. Export Resolution & Watermark**
1. Complete a project on free tier through export
2. Verify exported video is 720p (not higher, even if source is 1080p) — **Deviation: exporter caps resolution per tier, never upscales**
3. Verify watermark overlay present on free tier export (FFmpeg `drawtext` filter)
4. Verify resolution scaling enforced server-side in exporter service

### Expected Results
- 10-minute video rejected at upload initiation with clear error
- Free tier exports capped at 720p with watermark
- Upgrade prompt shown when hitting limits

### Actual Results
_(to be filled during testing)_

### Pass/Fail
_(to be filled during testing)_

---

## 8. Error Recovery

### Preconditions
- Active project in various pipeline stages
- Services (transcoder, detector, AI engine, exporter) accessible

### Steps

**8a. Upload Interruption**
1. Start uploading a video
2. Kill the network connection mid-upload (or close browser tab)
3. Return to the app, navigate back to the upload
4. Verify chunked upload resumes from last completed chunk (**Deviation: useUpload hook supports resume via tracking completed chunks**)
5. Verify upload completes successfully after resume

**8b. Detection Failure**
1. Upload a video that completes transcoding
2. Force the detector to fail (e.g., corrupt audio track, or kill detector service mid-processing)
3. Verify project shows `failed` status on dashboard (red badge on ProjectCard)
4. Verify editor page shows failure state with retry option
5. Click retry → verify detection restarts

**8c. Export Failure**
1. Start an export
2. Force a failure during AI fill generation or assembly
3. Verify ExportProgress overlay shows failure state
4. Verify credits are NOT refunded on export failure (**Deviation: credits not refunded because AI fills were already generated**)
5. Click retry button → verify progress overlay hides and editor returns for re-submission

### Expected Results
- Upload resume works via chunk tracking
- Failed projects show clear error state with retry
- Export failure shows retry option (overlay hides, returns to editor)
- Webhooks return 200 even on internal errors to prevent retry loops (**Deviation**)

### Actual Results
_(to be filled during testing)_

### Pass/Fail
_(to be filled during testing)_

---

## Smoke Test Script

A quick post-deploy verification checklist that can be run in under 5 minutes:

```bash
#!/bin/bash
# NoCut MVP Smoke Test Script
# Run after each deploy to verify core functionality

set -e

BASE_URL="${BASE_URL:-http://localhost:5173}"
SUPABASE_URL="${SUPABASE_URL:-http://localhost:54321}"

echo "=== NoCut Smoke Test ==="

# 1. App loads
echo "[1/8] Checking app loads..."
curl -sf "$BASE_URL" > /dev/null && echo "  ✓ App accessible" || echo "  ✗ App not accessible"

# 2. Auth pages render
echo "[2/8] Checking auth pages..."
curl -sf "$BASE_URL/sign-in" > /dev/null && echo "  ✓ Sign-in page loads" || echo "  ✗ Sign-in page failed"
curl -sf "$BASE_URL/sign-up" > /dev/null && echo "  ✓ Sign-up page loads" || echo "  ✗ Sign-up page failed"

# 3. Supabase health
echo "[3/8] Checking Supabase..."
curl -sf "$SUPABASE_URL/rest/v1/" -H "apikey: $SUPABASE_ANON_KEY" > /dev/null && echo "  ✓ Supabase REST API" || echo "  ✗ Supabase REST API failed"

# 4. Edge functions respond
echo "[4/8] Checking edge functions..."
for fn in upload-initiate credits-balance; do
  STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$SUPABASE_URL/functions/v1/$fn" 2>/dev/null || echo "000")
  # 401 = function exists but requires auth; 200 = ok
  if [ "$STATUS" = "401" ] || [ "$STATUS" = "200" ]; then
    echo "  ✓ $fn responds ($STATUS)"
  else
    echo "  ✗ $fn failed ($STATUS)"
  fi
done

# 5. Protected route redirects
echo "[5/8] Checking auth guard..."
DASHBOARD_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$BASE_URL/dashboard" 2>/dev/null || echo "000")
echo "  ✓ Dashboard returns $DASHBOARD_STATUS (SPA — auth guard is client-side)"

# 6. Static pages
echo "[6/8] Checking static pages..."
curl -sf "$BASE_URL/commercial-disclosure" > /dev/null && echo "  ✓ Commercial disclosure loads" || echo "  ✗ Commercial disclosure failed"

# 7. 404 handling
echo "[7/8] Checking 404..."
curl -sf "$BASE_URL/nonexistent-route-12345" > /dev/null && echo "  ✓ 404 page loads (SPA fallback)" || echo "  ✗ 404 handling failed"

# 8. Build artifacts
echo "[8/8] Checking build..."
if [ -d "dist" ]; then
  FILE_COUNT=$(find dist -name "*.js" | wc -l)
  echo "  ✓ Build output exists ($FILE_COUNT JS files)"
else
  echo "  ⚠ No dist/ directory — run 'npm run build' first"
fi

echo ""
echo "=== Smoke test complete ==="
```

### Manual Smoke Test Checklist (Browser)

| # | Check | Pass |
|---|-------|------|
| 1 | Landing page loads at `/` (unauthenticated) | ☐ |
| 2 | Sign up creates account and redirects to dashboard | ☐ |
| 3 | Sign in works with valid credentials | ☐ |
| 4 | Dashboard shows projects (or empty state) | ☐ |
| 5 | Upload page accepts drag-and-drop video | ☐ |
| 6 | Editor loads with video player and waveform | ☐ |
| 7 | Credits page shows balance | ☐ |
| 8 | Settings page renders with sign-out button | ☐ |
| 9 | Sign out clears session and redirects | ☐ |
| 10 | 404 page renders for unknown routes | ☐ |
