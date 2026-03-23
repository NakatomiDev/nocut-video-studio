# NoCut — AI Video Continuity Engine Specification

**Version:** 1.0
**Date:** March 2026
**Status:** Draft (Aligned with PRD v1.2 & Architecture v2.0)
**Classification:** Confidential

---

## Table of Contents

- [1. Overview](#1-overview)
- [2. Problem Definition](#2-problem-definition)
- [3. Engine Architecture](#3-engine-architecture)
- [4. Face Enrollment Pipeline](#4-face-enrollment-pipeline)
- [5. Boundary Analysis](#5-boundary-analysis)
- [6. Motion Synthesis (Fill Generation)](#6-motion-synthesis-fill-generation)
- [7. Temporal Compositing](#7-temporal-compositing)
- [8. Quality Assurance Pipeline](#8-quality-assurance-pipeline)
- [9. Provider Abstraction Layer](#9-provider-abstraction-layer)
- [10. Licensed API Integration (Phase 2 Launch)](#10-licensed-api-integration-phase-2-launch)
- [11. GCP Vertex AI Integration](#11-gcp-vertex-ai-integration)
- [12. Custom Model Development (Phase 3-4)](#12-custom-model-development-phase-3-4)
- [13. Credit Integration](#13-credit-integration)
- [14. Performance Requirements & Benchmarks](#14-performance-requirements--benchmarks)
- [15. Fallback Strategy](#15-fallback-strategy)
- [16. Ethical Safeguards](#16-ethical-safeguards)
- [17. Infrastructure & Scaling](#17-infrastructure--scaling)
- [18. API Specification](#18-api-specification)
- [19. Implementation Roadmap](#19-implementation-roadmap)

---

## 1. Overview

The AI Video Continuity Engine is the core technical differentiator of NoCut. It generates synthetic speaker footage that visually bridges gaps created when users remove unwanted segments (pauses, mistakes, retakes) from their video. The result is a final video that appears to have been recorded in one continuous, flawless take.

**Core Constraint:** 1 credit = 1 second of AI-generated fill. Every generation operation is metered against the user's credit balance (see Section 13).

**Phase 2 Launch Strategy:** Ship with licensed API providers (D-ID, HeyGen) behind an abstraction layer. Selectively use GCP Vertex AI for models unavailable on AWS. Begin custom model development in Phase 3.

---

## 2. Problem Definition

### 2.1 What the Engine Must Solve

When a user removes a segment from their video, the frames on either side of the cut rarely align visually. The speaker may be in a different head position, with a different expression, different mouth shape, or even different body posture. A simple hard cut creates a visible jump that breaks the illusion of a continuous recording.

The AI Engine must generate transitional video frames that:

- Start from the exact visual state of the last frame before the cut (the "exit frame")
- End at the exact visual state of the first frame after the cut (the "entry frame")
- Show natural, realistic human motion in between (not a morph or dissolve)
- Preserve the speaker's identity (face, skin tone, hair, clothing)
- Match the lighting, color temperature, and camera characteristics of the source footage
- Be indistinguishable from real footage at 1080p playback

### 2.2 Gap Types

| Gap Type | Duration | Difficulty | Phase |
|----------|----------|-----------|-------|
| Micro-gap (pause removal) | 0.3-1.0s | Low — minimal pose change, same expression | Phase 2 |
| Short gap (filler word removal) | 1.0-2.0s | Medium — slight pose shift, possible expression change | Phase 2 |
| Medium gap (retake removal) | 2.0-5.0s | High — significant pose/expression change, possible body movement | Phase 2 (Pro/Business) |
| Long gap (multi-sentence retake) | 5.0-15.0s | Very high — major visual discontinuity, may require multi-segment generation | Phase 4+ |

### 2.3 Input/Output Contract

**Input:**
- Source video file (S3 reference)
- Edit Decision List (EDL) with gap timestamps
- Speaker model (face enrollment data, S3 reference)
- Credit transaction ID (pre-authorized)

**Output:**
- One video segment per gap (MP4, H.264, matching source resolution)
- Quality metadata per segment (SSIM score, identity score, method used)
- Updated job status in Supabase DB

---

## 3. Engine Architecture

### 3.1 Pipeline Overview

```
Face Enrollment ──► Boundary Analysis ──► Motion Synthesis ──► Temporal Compositing ──► QA Pipeline
(once per video)     (per gap)             (per gap)           (per gap)                 (per gap)
                                               │
                                          Provider Router
                                          ┌────┼────┐
                                          ▼    ▼    ▼
                                        AWS  GCP  Licensed
                                        GPU  VAI  API
```

### 3.2 Component Summary

| Component | Technology | Runs On | Purpose |
|-----------|-----------|---------|---------|
| Face Enrollment | MediaPipe Face Mesh 0.10 + custom embedding encoder | AWS GPU | Build speaker identity model from source footage |
| Boundary Analyzer | OpenCV 4.x + NumPy | AWS GPU (co-located) | Extract boundary frames, compute visual deltas |
| Provider Router | Python service + Supabase config table | AWS GPU | Route generation requests to appropriate backend |
| Motion Generator (Licensed) | D-ID API / HeyGen API | External API | Generate fill frames via licensed provider |
| Motion Generator (GCP) | Vertex AI endpoint (Veo / Imagen Video) | GCP | Generate fill frames via Google models |
| Motion Generator (Custom) | Custom diffusion model (PyTorch) | AWS GPU | Phase 3-4: self-hosted generation |
| Temporal Compositor | PyTorch + FFmpeg | AWS GPU | Blend generated frames with source at boundaries |
| QA Pipeline | SSIM, ArcFace, optical flow analysis | AWS GPU | Validate output quality, decide pass/fail/retry |

---

## 4. Face Enrollment Pipeline

### 4.1 Purpose

Build a compact, reusable representation of the speaker's visual identity from the source video. This model is used to condition the generation process and validate outputs.

### 4.2 Process

1. **Face Detection:** Run MediaPipe Face Mesh on every Nth frame (N=5 for a 30fps video = 6 samples/second). Detect primary face bounding box. Reject frames with no face, multiple faces, or low confidence (< 0.9).

2. **Feature Extraction:**
   - **Facial geometry:** 468 3D face landmarks (MediaPipe) averaged across frames
   - **Identity embedding:** ArcFace (InsightFace) produces a 512-dimensional identity vector
   - **Skin tone profile:** Mean LAB color values sampled from forehead, cheek, chin regions
   - **Lighting profile:** Estimated ambient light direction and intensity from face shading
   - **Head pose distribution:** Histogram of yaw/pitch/roll values across the video (characterizes natural movement range)
   - **Micro-expression patterns:** Blink rate, mouth movement frequency, head sway amplitude

3. **Model Compilation:** All features are serialized into a single JSON + binary blob (the "speaker model"), encrypted with the user's key, and stored in S3.

### 4.3 Speaker Model Schema

```json
{
  "version": "1.0",
  "video_id": "uuid",
  "user_id": "uuid",
  "identity_embedding": [512 floats],
  "face_geometry": {
    "landmarks_mean": [468 x 3 floats],
    "landmarks_std": [468 x 3 floats]
  },
  "skin_tone": { "L": 65.2, "a": 12.1, "b": 18.7 },
  "lighting": {
    "direction": [0.3, -0.5, 0.8],
    "intensity": 0.72,
    "color_temp_kelvin": 5200
  },
  "head_pose": {
    "yaw_range": [-15, 20],
    "pitch_range": [-10, 8],
    "roll_range": [-5, 5],
    "dominant_pose": [2.1, -1.3, 0.4]
  },
  "micro_expressions": {
    "blink_rate_per_min": 17,
    "avg_mouth_aperture": 0.03,
    "head_sway_amplitude_deg": 3.2
  },
  "source_metadata": {
    "resolution": "1920x1080",
    "fps": 30,
    "codec": "h264",
    "duration_seconds": 300,
    "frames_sampled": 360
  }
}
```

### 4.4 Performance

- Enrollment time: < 30 seconds for a 5-minute video
- Model size: ~50KB (compressed)
- Reuse: Speaker model is cached and reused across multiple exports from the same video. Auto-expires after 30 days of inactivity.

---

## 5. Boundary Analysis

### 5.1 Purpose

For each gap in the EDL, extract the visual context on both sides of the cut and compute the "transition difficulty" — how different the exit frame looks from the entry frame.

### 5.2 Process

1. **Frame Extraction:** Extract the last 15 frames before the gap (exit buffer) and the first 15 frames after the gap (entry buffer) from the source video using FFmpeg.

2. **Face Registration:** Run MediaPipe on exit and entry frames. Align face bounding boxes. Compute per-frame face crops (256x256, centered on nose).

3. **Delta Computation:**

| Delta | Method | Output |
|-------|--------|--------|
| Pose delta | Difference in yaw/pitch/roll between last exit frame and first entry frame | 3 floats (degrees) |
| Expression delta | Difference in blendshape coefficients (52 ARKit-compatible coefficients) | 52 floats |
| Lighting delta | Difference in estimated light direction and intensity | 4 floats |
| Position delta | Difference in face center coordinates (normalized) | 2 floats |
| Scale delta | Difference in face bounding box size | 1 float |

4. **Difficulty Scoring:** Compute a composite difficulty score (0.0-1.0) based on weighted deltas:

```python
difficulty = (
    0.3 * normalize(pose_delta) +
    0.25 * normalize(expression_delta) +
    0.15 * normalize(lighting_delta) +
    0.15 * normalize(position_delta) +
    0.15 * normalize(scale_delta)
)
```

5. **Output:** Boundary analysis package containing exit frames, entry frames, delta metadata, difficulty score, and face crops.

### 5.3 Difficulty-Based Routing

| Difficulty Score | Recommended Approach | Expected Quality |
|-----------------|---------------------|-----------------|
| 0.0-0.3 (easy) | Simple interpolation or short diffusion generation | Very high |
| 0.3-0.6 (moderate) | Full diffusion generation with boundary conditioning | High |
| 0.6-0.8 (hard) | Full generation with extended diffusion steps | Medium-high |
| 0.8-1.0 (very hard) | Full generation + manual review flag | Medium (may fallback) |

---

## 6. Motion Synthesis (Fill Generation)

### 6.1 Generation Approaches

The engine supports three generation backends, selected by the Provider Router:

#### 6.1.1 Licensed API (D-ID / HeyGen) — Phase 2 Default

**How it works:** Send the speaker's reference image (extracted from source video) plus a "motion script" to the API. The API returns a video of the speaker with the specified motion.

**Adaptation for NoCut's use case:**
- Extract a high-quality reference frame from the source video (frontal, well-lit, neutral expression)
- For micro-gaps (< 1s): Request idle motion (blink, subtle head movement) conditioned on the exit frame pose
- For short gaps (1-3s): Request transition motion from exit pose to entry pose
- For medium gaps (3-5s): Chain multiple short generation requests

**D-ID specifics:**
- Endpoint: `POST /talks` (Speaking Portrait API)
- Input: source image + driver video or audio
- 1 D-ID credit = up to 15 seconds of video
- Estimated cost per NoCut credit (1s): ~$0.02-$0.05 depending on D-ID plan

**HeyGen specifics:**
- Endpoint: Video Generation API
- Input: avatar photo + script/motion parameters
- Avatar IV model supports realistic micro-expressions and lip sync
- Estimated cost per NoCut credit (1s): ~$0.03-$0.06

#### 6.1.2 GCP Vertex AI — Phase 2 (Selective)

**When used:** Only for specific capabilities unavailable from licensed APIs or AWS-hosted models. Examples include Google Veo for cinematic-quality video generation with superior temporal consistency, and Imagen Video for high-fidelity frame super-resolution.

**How it works:** Boundary frames are sent as base64 payloads in the Vertex AI prediction request. Model generates intermediate frames. Result returned in response body and written to S3.

**Cost:** Vertex AI inference pricing varies by model and compute. Budget $0.01-$0.10 per second of generated footage.

#### 6.1.3 Custom Model — Phase 3-4

See Section 12 for the custom model development plan.

### 6.2 Generation Parameters

| Parameter | Description | Default | Configurable |
|-----------|-------------|---------|-------------|
| `fill_duration_seconds` | How many seconds of footage to generate | Calculated from gap | No |
| `target_fps` | Frame rate of generated footage | Matches source (typically 30) | No |
| `generation_resolution` | Resolution for generation step | 512x512 | No |
| `output_resolution` | Final resolution after super-resolution | Matches source | No |
| `diffusion_steps` | Number of denoising steps (custom model only) | 30 | Yes (retry increases to 50) |
| `conditioning_strength` | How strongly boundary frames influence generation | 0.8 | Yes (retry adjusts) |
| `idle_motion_intensity` | Amplitude of idle movement (blink, sway) | 0.5 | No |
| `quality_threshold` | Minimum SSIM to pass QA | 0.85 | Per-tier (Business: 0.90) |

---

## 7. Temporal Compositing

### 7.1 Purpose

Blend the AI-generated frames seamlessly with the real footage at both cut boundaries. Even high-quality generated frames will show a visible "pop" without proper compositing.

### 7.2 Blending Process

1. **Temporal Crossfade (5 frames each side):**
   - First 5 frames of generated segment: alpha-blended with last 5 frames of pre-gap source footage (alpha ramps from 0.0 to 1.0)
   - Last 5 frames of generated segment: alpha-blended with first 5 frames of post-gap source footage (alpha ramps from 1.0 to 0.0)

2. **Color Matching:**
   - Compute color histogram of the source footage within a 2-second window around the gap
   - Apply histogram transfer to the generated frames to match source color grading
   - Fine-tune with LAB color space adjustment using the speaker model's skin tone as anchor

3. **Grain/Noise Matching:**
   - Estimate noise profile of source footage (ISO noise characteristics)
   - Apply matching synthetic grain to generated frames (which are typically too clean)
   - Match noise intensity per-channel (Y, Cb, Cr)

4. **Resolution Upscaling (if needed):**
   - If generation happened at 512x512, upscale to source resolution using Real-ESRGAN or similar super-resolution model
   - Apply sharpening to match source footage's perceived sharpness

5. **Audio Handling:**
   - Generated segments are video-only (no audio)
   - Audio continuity is handled by the Export Service, which applies a crossfade across the gap in the audio track
   - If lip-sync was generated, the corresponding audio is spliced in

### 7.3 Output

A single MP4 file per gap containing the composited frames, ready for assembly by the Export Service.

---

## 8. Quality Assurance Pipeline

### 8.1 Automated Checks

Every generated segment passes through automated QA before being accepted:

| Check | Method | Threshold | Weight |
|-------|--------|-----------|--------|
| **Structural Similarity (SSIM)** | Compare generated boundary frames against source boundary frames | >= 0.85 (standard) / >= 0.90 (Business) | 30% |
| **Identity Preservation** | ArcFace cosine similarity between generated face and speaker model | >= 0.95 | 30% |
| **Temporal Consistency** | Optical flow magnitude variance across generated frames (should be smooth) | Variance < 2.0 px/frame | 20% |
| **Color Consistency** | Mean deltaE (CIEDE2000) between generated and source boundary frames | deltaE < 3.0 | 10% |
| **Artifact Detection** | CNN-based artifact classifier (detects uncanny valley, warping artifacts) | Confidence < 0.15 | 10% |

### 8.2 Composite Quality Score

```python
quality_score = (
    0.30 * ssim_score +
    0.30 * identity_score +
    0.20 * temporal_score +
    0.10 * color_score +
    0.10 * (1.0 - artifact_score)
)
```

### 8.3 QA Decision Tree

```
quality_score >= threshold?
  YES --> PASS --> Segment accepted, proceed to export
  NO  --> Has this been retried?
          NO  --> RETRY --> Re-run with adjusted parameters (costs 1 additional credit)
          YES --> FALLBACK --> Use crossfade (Level 2) or hard cut (Level 3), refund credits
```

---

## 9. Provider Abstraction Layer

### 9.1 Purpose

Decouple the generation backend from the rest of the system so providers can be swapped, A/B tested, and gradually migrated without touching upstream services.

### 9.2 Interface

Every provider implements the same interface:

```python
class FillProvider(ABC):
    @abstractmethod
    async def generate(self, request: FillRequest) -> FillResult:
        """Generate fill frames for a single gap."""
        pass

    @abstractmethod
    async def health_check(self) -> bool:
        """Check if the provider is available."""
        pass

@dataclass
class FillRequest:
    gap_id: str
    exit_frames: List[np.ndarray]       # Last N frames before gap
    entry_frames: List[np.ndarray]      # First N frames after gap
    speaker_model: SpeakerModel
    delta_metadata: DeltaMetadata
    fill_duration_seconds: float
    target_fps: int
    target_resolution: Tuple[int, int]
    quality_tier: str                   # 'standard' or 'premium'

@dataclass
class FillResult:
    frames: List[np.ndarray]
    provider: str                       # 'did', 'heygen', 'gcp_veo', 'custom'
    generation_time_seconds: float
    raw_quality_score: float
    metadata: dict
```

### 9.3 Model Routing Configuration

Stored in Supabase `model_routing` table:

| generation_type | quality_tier | provider | weight | active |
|----------------|-------------|----------|--------|--------|
| `micro_gap` | `standard` | `did_api` | 100 | true |
| `short_gap` | `standard` | `did_api` | 80 | true |
| `short_gap` | `standard` | `heygen_api` | 20 | true |
| `medium_gap` | `standard` | `heygen_api` | 100 | true |
| `micro_gap` | `premium` | `gcp_veo` | 100 | true |
| `*` | `*` | `custom_v1` | 0 | false |

**Weight** enables traffic splitting for A/B testing. When `custom_v1` is ready in Phase 3, its weight is gradually increased while licensed API weight decreases.

---

## 10. Licensed API Integration (Phase 2 Launch)

### 10.1 D-ID Integration

**API:** D-ID Talks API (Speaking Portrait)

**Workflow:**
1. Extract high-quality reference image from source video (frontal, well-lit)
2. Prepare driver parameters (target pose, expression, duration)
3. POST to D-ID `/talks` endpoint with reference image + driver
4. Poll for completion (or use webhook callback)
5. Download generated video, extract frames
6. Pass to Temporal Compositor for blending

**Key Considerations:**
- D-ID generates from a single reference image, not video-to-video — we lose some source-video-specific detail
- D-ID credits: 1 credit = up to 15 seconds. At scale, NoCut pays ~$0.02-$0.05 per second
- Latency: 15-45 seconds per generation (network round-trip + processing)
- Rate limits: Depends on D-ID plan tier (Advanced: 100 concurrent, Enterprise: custom)

### 10.2 HeyGen Integration

**API:** HeyGen Video Generation API

**Workflow:**
1. Create a "Photo Avatar" from the reference image (one-time per speaker)
2. For each gap: generate a video with the avatar showing target motion
3. Retrieve generated video, extract frames
4. Pass to Temporal Compositor

**Key Considerations:**
- HeyGen's Avatar IV model produces highly realistic micro-expressions
- Better for longer gaps (2-5s) where natural expression variation matters
- Higher per-second cost than D-ID but potentially better quality for complex transitions
- API supports voice cloning and lip sync, useful for future "verbal bridge" features

### 10.3 Provider Cost Comparison

| Provider | Est. Cost per NoCut Credit (1s) | Quality (subjective) | Latency | Best For |
|----------|-------------------------------|---------------------|---------|----------|
| D-ID | $0.02-$0.05 | Good | 15-30s | Micro and short gaps |
| HeyGen | $0.03-$0.06 | Very good | 20-45s | Medium gaps, complex expressions |
| GCP Veo | $0.05-$0.10 | Excellent | 30-60s | Premium tier, high difficulty gaps |

**Unit Economics:** At Pro tier ($14.99/mo for 60 credits), NoCut receives ~$0.25 per credit. With provider costs of $0.02-$0.10, gross margin per credit ranges from 60%-92%. The credit pricing is calibrated to maintain >60% gross margin even on the most expensive generation paths.

---

## 11. GCP Vertex AI Integration

### 11.1 When to Use GCP

GCP Vertex AI is used only when a specific model capability is unavailable on AWS or licensed APIs:

- **Google Veo:** For premium-tier video generation with superior temporal consistency
- **Imagen (frame super-resolution):** If Real-ESRGAN quality is insufficient
- **Future Google video models:** As Google releases new video generation capabilities

### 11.2 Integration Architecture

```
AI Engine (AWS GPU)
  --> Extracts boundary frames
  --> Encodes as base64
  --> POST to GCP Vertex AI endpoint
  --> Receives generated frames in response
  --> Writes to S3, continues pipeline on AWS
```

**No persistent data on GCP.** Frames transit via API payloads only.

### 11.3 Configuration

- GCP project with Vertex AI API enabled
- Service account with minimal permissions (Vertex AI User role only)
- API key stored in AWS Secrets Manager
- Vertex AI endpoint configured with auto-scaling (scale-to-zero when idle)
- Latency budget: Add 200-500ms for cross-cloud network round-trip

---

## 12. Custom Model Development (Phase 3-4)

### 12.1 Architecture

The custom model is a **boundary-conditioned video diffusion model** that generates intermediate frames given:
- Exit boundary frames (last 15 frames before gap)
- Entry boundary frames (first 15 frames after gap)
- Speaker identity embedding (from Face Enrollment)
- Target duration and FPS

### 12.2 Model Design

- **Base architecture:** Latent video diffusion model (similar to Stable Video Diffusion)
- **Conditioning:** Cross-attention on boundary frame encodings + speaker embedding
- **Training data:** Internal dataset of talking-head videos with synthetic gap-and-fill pairs
- **Resolution:** Generate at 512x512, upscale with Real-ESRGAN
- **Inference:** 30 diffusion steps (standard), 50 steps (retry/premium)

### 12.3 Training Pipeline

1. **Data Collection:** Source talking-head videos from licensed datasets + internal recordings
2. **Gap Synthesis:** Programmatically create training pairs by removing segments and using the surrounding footage as ground truth
3. **Training:** Fine-tune from a pre-trained video diffusion checkpoint (e.g., SVD or open-source equivalent)
4. **Evaluation:** Compare against licensed API outputs on a held-out test set. Must match or exceed quality scores.

### 12.4 Transition Plan

| Phase | Status | Traffic Weight |
|-------|--------|---------------|
| Phase 2 (launch) | Licensed APIs only | 100% licensed |
| Phase 3 (month 1-3) | Custom model in shadow mode (generates but not served) | 0% custom, 100% licensed |
| Phase 3 (month 4-6) | Custom model in canary (5% of easy gaps) | 5% custom, 95% licensed |
| Phase 4 (month 1-3) | Custom model expanded to 50% of easy + moderate gaps | 50% custom, 50% licensed |
| Phase 4 (month 4+) | Custom model primary (100% of easy/moderate, licensed for hard gaps only) | 80%+ custom |

Quality scores are tracked per-provider per-difficulty-level. The transition only proceeds when custom model quality meets or exceeds the licensed API at each difficulty tier.

---

## 13. Credit Integration

### 13.1 Credit Flow in the AI Engine

```
1. User submits EDL in Lovable app
2. Supabase Edge Function calculates total credits needed:
   credits_required = SUM(gap_duration_seconds) for all gaps
3. Edge Function deducts credits atomically from credit_ledger
4. Edge Function enqueues AI fill job with credit_transaction_id
5. AI Engine processes each gap
6. On success: no further credit action (already deducted)
7. On failure + fallback: Edge Function refunds credits for failed gaps
```

### 13.2 Credit Accounting per Gap

| Outcome | Credit Impact |
|---------|--------------|
| AI fill succeeds (QA pass) | No refund — credits consumed as expected |
| AI fill succeeds after retry | 1 additional credit charged for the retry |
| AI fill fails, crossfade fallback | Credits for this gap refunded |
| AI fill fails, hard cut fallback | Credits for this gap refunded |
| Entire job fails (system error) | All credits for the job refunded |

### 13.3 Cost-Per-Credit Economics

| Scenario | Provider Cost | NoCut Credit Revenue | Gross Margin |
|----------|--------------|---------------------|-------------|
| Pro subscriber (easy gap, D-ID) | $0.02 | $0.25 | 92% |
| Pro subscriber (medium gap, HeyGen) | $0.06 | $0.25 | 76% |
| Pro annual (easy gap, D-ID) | $0.02 | $0.17 | 88% |
| Business subscriber (hard gap, GCP Veo) | $0.10 | $0.20 | 50% |
| Top-up user (easy gap, D-ID) | $0.02 | $0.33-$0.50 | 94-96% |
| Free tier (micro gap, D-ID) | $0.02 | $0.00 | -100% (loss leader) |

**Target:** Blended gross margin > 70% across all credit types and providers.

---

## 14. Performance Requirements & Benchmarks

### 14.1 Latency Targets

| Metric | Target | Measurement Point |
|--------|--------|------------------|
| Face enrollment | < 30 seconds | Upload complete to speaker model in S3 |
| Boundary analysis | < 5 seconds per gap | Job start to boundary package ready |
| Fill generation (1s, licensed API) | < 30 seconds | API request to frames received |
| Fill generation (3s, licensed API) | < 90 seconds | Same |
| Fill generation (1s, GCP Vertex) | < 45 seconds | Including cross-cloud latency |
| Temporal compositing | < 10 seconds per gap | Frames received to composited segment in S3 |
| QA pipeline | < 5 seconds per gap | Composited segment to QA verdict |
| **Total per gap (1s, typical)** | **< 60 seconds** | **Job start to segment ready in S3** |

### 14.2 Quality Targets

| Metric | Target | Method |
|--------|--------|--------|
| SSIM (boundary match) | >= 0.85 (standard) / >= 0.90 (premium) | Structural similarity at boundary frames |
| Identity preservation | >= 0.95 cosine similarity | ArcFace embedding comparison |
| Temporal smoothness | Flow variance < 2.0 px/frame | Optical flow analysis across generated frames |
| Color consistency | deltaE < 3.0 | CIEDE2000 color difference at boundaries |
| Artifact rate | < 5% of generated segments | CNN artifact classifier |
| Fallback rate | < 15% of gaps | Gaps that fail QA and use non-AI fallback |
| User quality rating | >= 4.0/5.0 | Post-export user survey |

### 14.3 Throughput Targets

| Scale | Concurrent Jobs | Avg. Wait (Free) | Avg. Wait (Pro) | Avg. Wait (Business) |
|-------|----------------|------------------|-----------------|---------------------|
| 10K MAU | 20 | < 5 min | < 2 min | < 1 min |
| 100K MAU | 100 | < 10 min | < 3 min | < 1 min |

---

## 15. Fallback Strategy

### 15.1 Fallback Levels

**Level 1 — Retry with adjusted parameters:**
- Increase diffusion steps (30 to 50 for custom model)
- Tighten conditioning strength (0.8 to 0.95)
- Try an alternative provider (if available in routing config)
- Costs 1 additional credit (user is informed). Only attempted once per gap.

**Level 2 — Crossfade (morph cut):**
- Apply a smooth 0.3-0.5s visual crossfade between exit and entry frames
- Uses optical flow to find alignment between frames, then alpha-blends
- No credit cost. Credits for this gap are refunded.
- Quality: Acceptable for micro-gaps and some short gaps. Noticeable for larger pose changes.

**Level 3 — Hard cut with audio smoothing:**
- Traditional jump cut with no visual smoothing
- Audio track gets a 100ms crossfade to minimize the audio pop
- No credit cost. Credits for this gap are refunded.

### 15.2 User Communication

Per-gap indicator in the export:
- "AI Generated" (green) — AI fill passed QA
- "Smoothed Transition" (yellow) — crossfade fallback used
- "Hard Cut" (red) — jump cut with audio smoothing

User can choose to accept or request a re-generation (costs credits).

---

## 16. Ethical Safeguards

### 16.1 Same-Speaker Enforcement

- **Enrollment binding:** Speaker model derived exclusively from uploaded video. No external face injection.
- **Identity verification at output:** QA pipeline checks generated faces match speaker model (cosine similarity >= 0.95). Divergent faces are rejected.
- **No cross-user generation:** Speaker models encrypted with user-specific keys, scoped via Supabase RLS.

### 16.2 Content Provenance (C2PA)

- Every AI-generated segment tagged with metadata: timestamps, generation method, model version, provider
- Export Service embeds C2PA Content Credentials in final video
- AI-generated segments labeled so verification tools can identify them

### 16.3 Rate Limiting

- Maximum fill duration per export: 30 seconds (prevents abuse)
- Maximum exports per day: 50 (Pro), 100 (Business)
- Anomaly detection: Flag users generating unusually high volumes of AI footage

### 16.4 Audit Trail

Every AI generation event logged in Supabase `audit_log`:
- User ID, project ID, gap timestamps
- Provider used, generation parameters
- Input hash (boundary frames), output hash (generated segment)
- Quality scores, method used (AI/crossfade/hard cut)
- Credit transaction ID

---

## 17. Infrastructure & Scaling

### 17.1 AWS GPU Fleet

| Instance Type | GPU | Use Case | Scaling |
|--------------|-----|----------|---------|
| g5.xlarge | 1x NVIDIA A10G (24GB) | Face enrollment, boundary analysis, compositing, QA | Auto-scale 2-20 on queue depth |
| g5.2xlarge | 1x NVIDIA A10G (24GB) | Custom model inference (Phase 3+) | Auto-scale 2-10 on ai.fill queue |
| Spot instances | Same | Free and Pro tier non-priority jobs | ~60% cost reduction |
| On-demand | Same | Business tier priority jobs | Guaranteed availability |

### 17.2 GCP Vertex AI

- Endpoint: Auto-scaled, scale-to-zero when idle
- Machine type: n1-standard-8 + NVIDIA T4 or A100 (model-dependent)
- Region: us-central1 (lowest latency from AWS us-east-1)

### 17.3 Queue Configuration

The `ai.fill` BullMQ queue:
- Concurrency: 1 job per GPU worker
- Priority: Business=1, Pro=5, Free=10
- Retry: 2 attempts (retries are expensive)
- Timeout: 5 minutes per gap
- DLQ: Failed jobs after retries. Credits auto-refunded before DLQ.

---

## 18. API Specification

### 18.1 Internal API (Supabase Edge Functions to AI Engine)

**Enqueue Fill Job:**

```json
POST /ai-engine/fill
{
  "job_id": "uuid",
  "project_id": "uuid",
  "video_id": "uuid",
  "user_id": "uuid",
  "credit_transaction_id": "uuid",
  "speaker_model_s3_key": "speaker-models/{user_id}/{model_id}.enc",
  "source_video_s3_key": "uploads/{user_id}/{project_id}/source.mp4",
  "gaps": [
    {
      "gap_id": "gap_001",
      "start_seconds": 12.34,
      "end_seconds": 14.67,
      "fill_duration_seconds": 1.0,
      "credits_allocated": 1
    }
  ],
  "quality_tier": "standard",
  "target_resolution": [1920, 1080],
  "target_fps": 30
}
```

**Job Status Update (AI Engine to Supabase):**

```json
PATCH /jobs/{job_id}/status
{
  "status": "processing | completed | failed",
  "gaps_completed": 3,
  "gaps_total": 5,
  "results": [
    {
      "gap_id": "gap_001",
      "status": "completed",
      "method": "ai_fill | crossfade | hard_cut",
      "provider": "did_api | heygen_api | gcp_veo | custom_v1",
      "s3_key": "ai-fills/{user_id}/{project_id}/gap_001.mp4",
      "quality_score": 0.91,
      "generation_time_seconds": 28.5,
      "credits_consumed": 1,
      "credits_refunded": 0
    }
  ]
}
```

---

## 19. Implementation Roadmap

### Phase 2: Launch (Weeks 9-18)

- [ ] Implement Face Enrollment pipeline (MediaPipe + ArcFace)
- [ ] Implement Boundary Analyzer (frame extraction + delta computation)
- [ ] Integrate D-ID API as primary licensed provider
- [ ] Integrate HeyGen API as secondary provider
- [ ] Implement Provider Router with Supabase config table
- [ ] Implement Temporal Compositor (crossfade blending + color matching)
- [ ] Implement QA Pipeline (SSIM, identity, temporal, artifact checks)
- [ ] Implement fallback strategy (retry, crossfade, hard cut)
- [ ] Integrate credit deduction and refund flows
- [ ] Build C2PA metadata tagging into generated segments
- [ ] Set up AWS GPU auto-scaling (g5.xlarge fleet)
- [ ] Deploy and benchmark: target < 60s per 1s fill
- [ ] Beta test with 100+ videos, achieve >= 4.0/5.0 quality rating

### Phase 2.5: GCP Integration

- [ ] Set up GCP Vertex AI endpoint for Veo model
- [ ] Implement GCP provider in abstraction layer
- [ ] Configure cross-cloud data handling (base64 payloads, no GCS storage)
- [ ] Add GCP route to model routing config for premium tier
- [ ] Benchmark GCP latency and quality vs. licensed APIs

### Phase 3: Custom Model Development (Weeks 19-34)

- [ ] Assemble training dataset (talking-head videos with synthetic gaps)
- [ ] Fine-tune video diffusion model from pre-trained checkpoint
- [ ] Implement custom model provider in abstraction layer
- [ ] Shadow mode: generate alongside licensed APIs, compare quality
- [ ] Canary mode: serve 5% of easy gaps with custom model
- [ ] Iterate on model quality based on QA scores and user feedback

### Phase 4: Custom Model as Primary (Weeks 35+)

- [ ] Expand custom model to 50% of easy + moderate gaps
- [ ] Optimize inference for cost reduction (quantization, batching)
- [ ] Reduce dependency on licensed APIs to hard gaps only
- [ ] Target: 80%+ of generation on custom model
- [ ] Evaluate: unit economics improvement vs. licensed API baseline
