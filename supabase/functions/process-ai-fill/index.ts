import { S3Client, CopyObjectCommand, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "npm:@aws-sdk/client-s3";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { handleCors } from "../_shared/cors.ts";
import {
  getAuthenticatedUser,
  createServiceClient,
  AuthError,
} from "../_shared/auth.ts";
import { successResponse, errorResponse } from "../_shared/response.ts";
import {
  MODEL_CREDITS_PER_SEC,
  DEFAULT_AI_FILL_MODEL,
  type AiFillModel,
} from "../_shared/credits.ts";
import {
  getVertexAccessToken,
  getGcpProjectId,
  getGcpRegion,
  vertexVeoUrl,
  vertexGeminiUrl,
  vertexPollUrl,
} from "../_shared/gcp-auth.ts";

/**
 * Independently recalculate the credit cost from edl_json entries.
 * This prevents attackers from inserting edit_decisions with credits_charged=0
 * while requesting non-zero fill durations.
 */
function recalculateCreditsFromEdl(edlJson: EdlEntry[], defaultModel: string): number {
  let total = 0;
  for (const entry of edlJson) {
    // Skip existing fills — they don't cost credits
    if (entry.fill_duration > 0 && !entry.existing_fill_s3_key) {
      const model = (entry.model ?? defaultModel) as AiFillModel;
      const creditsPerSec = MODEL_CREDITS_PER_SEC[model] ?? 1;
      total += entry.fill_duration * creditsPerSec;
    }
  }
  return total;
}

interface EdlEntry {
  start: number;
  end: number;
  type: string;
  fill_duration: number;
  model?: string;
  existing_fill_s3_key?: string;
  prompt?: string;
  audio_prompt?: string;
}

let _s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (!_s3Client) {
    _s3Client = new S3Client({
      region: Deno.env.get("AWS_REGION")!,
      credentials: {
        accessKeyId: Deno.env.get("AWS_ACCESS_KEY_ID")!,
        secretAccessKey: Deno.env.get("AWS_SECRET_ACCESS_KEY")!,
      },
    });
  }
  return _s3Client;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "Only POST is allowed", 405);
  }

  try {
    // 1. Authenticate
    let user;
    try {
      const auth = await getAuthenticatedUser(req);
      user = auth.user;
    } catch (err) {
      if (err instanceof AuthError) {
        return errorResponse("unauthorized", err.message, 401);
      }
      throw err;
    }

    // 2. Parse request — accept job_id or poll for next queued job
    const body = await req.json();
    const { job_id } = body;

    const serviceClient = createServiceClient();

    // 3. Load the job
    let job;
    if (job_id) {
      const { data, error } = await serviceClient
        .from("job_queue")
        .select("*")
        .eq("id", job_id)
        .single();
      if (error || !data) {
        return errorResponse("not_found", "Job not found", 404);
      }
      job = data;
    } else {
      const { data, error } = await serviceClient
        .from("job_queue")
        .select("*")
        .eq("user_id", user.id)
        .eq("type", "ai.fill")
        .eq("status", "queued")
        .order("priority", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(1)
        .single();
      if (error || !data) {
        return errorResponse("not_found", "No queued ai.fill jobs found", 404);
      }
      job = data;
    }

    // 4. Verify ownership and job type
    if (job.user_id !== user.id) {
      return errorResponse("forbidden", "You do not own this job", 403);
    }
    if (job.type !== "ai.fill" && job.type !== "video.export") {
      return errorResponse("invalid_request", `Unexpected job type: ${job.type}`, 400);
    }
    if (job.status !== "queued") {
      return errorResponse("conflict", `Job already ${job.status}`, 409);
    }

    const payload = job.payload as { edit_decision_id: string; preview?: boolean };
    if (!payload?.edit_decision_id) {
      return errorResponse("invalid_request", "Job payload missing edit_decision_id", 400);
    }
    const isPreview = !!payload.preview;

    // 5. Load edit decision
    const { data: editDecision, error: edError } = await serviceClient
      .from("edit_decisions")
      .select("*, projects(id, user_id, status)")
      .eq("id", payload.edit_decision_id)
      .single();

    if (edError || !editDecision) {
      return errorResponse("not_found", "Edit decision not found", 404);
    }

    const project = editDecision.projects as { id: string; user_id: string; status: string };

    // Verify the edit decision's project belongs to the requesting user
    if (project.user_id !== user.id) {
      return errorResponse("forbidden", "Forbidden", 403);
    }
    const edlJson = editDecision.edl_json as EdlEntry[];
    const totalFillSeconds = editDecision.total_fill_seconds as number;
    const creditsCharged = editDecision.credits_charged as number;
    const defaultModel = (editDecision.model as string) ?? "veo3.1-fast";

    const { data: projectVideo } = await serviceClient
      .from("videos")
      .select("proxy_s3_key, s3_key")
      .eq("project_id", project.id)
      .single();
    const sourceVideoKey = projectVideo?.proxy_s3_key || projectVideo?.s3_key || null;

    // 6. Claim the job — mark as processing
    await serviceClient
      .from("job_queue")
      .update({ status: "processing", started_at: new Date().toISOString(), attempts: job.attempts + 1 })
      .eq("id", job.id);

    // 7. Server-side credit validation: recalculate from edl_json, never trust stored value
    const serverCalculatedCredits = recalculateCreditsFromEdl(edlJson, defaultModel);

    if (serverCalculatedCredits > 0 && creditsCharged < serverCalculatedCredits) {
      console.error(
        `Credit mismatch: edit_decision ${editDecision.id} claims ${creditsCharged} credits ` +
        `but EDL requires ${serverCalculatedCredits}. Rejecting.`
      );
      await failJob(serviceClient, job.id, editDecision.id, "Credit validation failed: insufficient credits declared", isPreview);
      return errorResponse("invalid_request", "Credit validation failed", 400);
    }

    // Credits were already deducted by preview-fill (or the initiating function).
    // Do NOT deduct again here — just read the transaction ID from edit_decisions.
    const creditTransactionId: string | null = (editDecision.credit_transaction_id as string) ?? null;

    if (!creditTransactionId && serverCalculatedCredits > 0) {
      // Safety: if somehow no transaction was recorded but credits are required, reject
      console.error(`No credit_transaction_id on edit_decision ${editDecision.id} but ${serverCalculatedCredits} credits required`);
      await failJob(serviceClient, job.id, editDecision.id, "Missing credit transaction — cannot proceed", isPreview);
      return errorResponse("internal_error", "Credit accounting error", 500);
    }

    await serviceClient
      .from("edit_decisions")
      .update({ status: "generating" })
      .eq("id", editDecision.id);

    if (!isPreview) {
      await serviceClient
        .from("projects")
        .update({ status: "generating" })
        .eq("id", project.id);
    }

    const fillGaps = edlJson
      .map((entry, index) => ({ ...entry, gap_index: index }))
      .filter((entry) => entry.fill_duration > 0);

    const totalGaps = fillGaps.length;
    const aiFillResults: Array<{ gap_index: number; id: string }> = [];

    for (let i = 0; i < fillGaps.length; i++) {
      const gap = fillGaps[i];

      const progressPercent = Math.round((i / totalGaps) * 100);
      await serviceClient
        .from("job_queue")
        .update({ progress_percent: progressPercent })
        .eq("id", job.id);

      const generationStart = Date.now();

      let fillS3Key: string;
      let fillProvider: string;
      let fillModel: string;
      let fillQualityScore: number;

      if (gap.existing_fill_s3_key) {
        // Reuse existing AI fill — copy the S3 object to the new edit decision path
        const bucket = Deno.env.get("AWS_S3_BUCKET")!;
        const newS3Key = `ai-fills/${project.id}/${editDecision.id}/gap_${gap.gap_index}_${gap.fill_duration}s.mp4`;

        try {
          await getS3Client().send(new CopyObjectCommand({
            Bucket: bucket,
            CopySource: `${bucket}/${gap.existing_fill_s3_key}`,
            Key: newS3Key,
          }));
          console.log(`Copied existing fill ${gap.existing_fill_s3_key} → ${newS3Key}`);
        } catch (copyErr) {
          console.error(`Failed to copy existing fill, will regenerate: ${(copyErr as Error).message}`);
          // Fall through to generation below
        }

        // Check if copy succeeded by checking if we got here without throwing
        fillS3Key = newS3Key;
        fillProvider = "reuse";
        fillModel = gap.model ?? defaultModel;
        fillQualityScore = 0.9;
      } else {
        // Generate new AI fill
        // Ensure boundary frames are extracted before loading them
        await ensureFramesExtracted(serviceClient, project.id, user.id, sourceVideoKey, [gap.start, gap.end]);

        // Load boundary frames from S3: gap.start = last frame before cut, gap.end = first frame after cut
        const firstFrameBase64 = await loadFrameBase64(project.id, gap.start);
        const lastFrameBase64 = await loadFrameBase64(project.id, gap.end);

        if (!firstFrameBase64 && !lastFrameBase64) {
          console.warn(
            `Frame conditioning unavailable for gap ${gap.gap_index}: neither boundary frame could be loaded. ` +
            `Proceeding without frame conditioning — generated video may not perfectly match source.`
          );
        }
        if (!firstFrameBase64) {
          console.warn(`First frame (timestamp ${gap.start}) could not be loaded — only last frame conditioning will be used`);
        }
        if (!lastFrameBase64) {
          console.warn(`Last frame (timestamp ${gap.end}) could not be loaded — only first frame conditioning will be used`);
        }

        let fillResult: FillResponse;
        try {
          fillResult = await generateAiFill({
            projectId: project.id,
            editDecisionId: editDecision.id,
            gapIndex: gap.gap_index,
            startTime: gap.end,
            duration: gap.fill_duration,
            sourceVideoKey,
            model: gap.model ?? defaultModel,
            firstFrameBase64,
            lastFrameBase64,
            prompt: gap.prompt,
            audioPrompt: gap.audio_prompt,
          });
        } catch (fillErr) {
          const msg = `AI fill generation failed for gap ${gap.gap_index}: ${(fillErr as Error).message}`;
          console.error(msg);

          // Refund credits since generation failed
          await refundOnFailure(serviceClient, creditTransactionId);

          await failJob(serviceClient, job.id, editDecision.id, msg, isPreview);
          return errorResponse("ai_generation_failed", msg, 502);
        }

        fillS3Key = fillResult.s3_key;
        fillProvider = fillResult.provider;
        fillModel = fillResult.model;
        fillQualityScore = fillResult.quality_score;
      }

      const generationTimeMs = Date.now() - generationStart;

      const aiFillId = crypto.randomUUID();
      const { error: fillInsertError } = await serviceClient
        .from("ai_fills")
        .insert({
          id: aiFillId,
          edit_decision_id: editDecision.id,
          gap_index: gap.gap_index,
          s3_key: fillS3Key,
          method: "ai_fill",
          provider: fillProvider,
          model: fillModel,
          quality_score: fillQualityScore,
          duration: gap.fill_duration,
          generation_time_ms: generationTimeMs,
        });

      if (fillInsertError) {
        const msg = `Failed to persist ai_fill for gap ${gap.gap_index}: ${fillInsertError.message}`;
        console.error(msg);
        // Refund credits since fill couldn't be persisted
        await refundOnFailure(serviceClient, creditTransactionId);
        await failJob(serviceClient, job.id, editDecision.id, msg, isPreview);
        return errorResponse("internal_error", msg, 500);
      }

      aiFillResults.push({ gap_index: gap.gap_index, id: aiFillId });
    }

    await serviceClient
      .from("job_queue")
      .update({
        status: "complete",
        progress_percent: 100,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    await serviceClient
      .from("edit_decisions")
      .update({ status: "exporting" })
      .eq("id", editDecision.id);

    if (!isPreview) {
      // Enqueue the video.export job so the exporter service stitches the final video
      const { data: exportJobData, error: exportJobError } = await serviceClient
        .from("job_queue")
        .insert({
          user_id: user.id,
          project_id: project.id,
          type: "video.export",
          status: "queued",
          payload: {
            project_id: project.id,
            edit_decision_id: editDecision.id,
          },
          priority: 10,
        })
        .select("id")
        .single();

      if (exportJobError) {
        console.error("Failed to enqueue video.export job:", exportJobError.message);
        // Don't fail the whole request — fills are saved; user can retry export
      }

      await serviceClient
        .from("projects")
        .update({ status: "exporting" })
        .eq("id", project.id);

      // Invoke export-video edge function. We must await the fetch so the
      // request is actually sent before this function returns — otherwise the
      // Deno runtime kills the in-flight request on function termination.
      // We only await the HTTP response (not the full export), because
      // export-video streams its work independently once it receives the job.
      const exportJobId = exportJobData?.id;
      if (!exportJobError && exportJobId) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        try {
          const exportRes = await fetch(`${supabaseUrl}/functions/v1/export-video`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({ job_id: exportJobId }),
          });
          if (!exportRes.ok) {
            const body = await exportRes.text();
            console.error(`export-video returned ${exportRes.status}: ${body}`);
          }
        } catch (err) {
          console.error("Failed to invoke export-video:", err);
        }
      }
    } else {
      // Preview mode — no export needed, just mark ready
      await serviceClient
        .from("edit_decisions")
        .update({ status: "complete" })
        .eq("id", editDecision.id);
    }

    return successResponse({
      job_id: job.id,
      edit_decision_id: editDecision.id,
      fills_generated: aiFillResults.length,
      total_fill_seconds: totalFillSeconds,
      credits_charged: creditsCharged,
      credit_transaction_id: creditTransactionId,
      ai_fills: aiFillResults,
    });
  } catch (err) {
    console.error("Unhandled error in process-ai-fill:", err);
    // Best-effort refund on unexpected errors — we don't have creditTransactionId
    // in scope here, but the edit_decision should have it if credits were taken
    return errorResponse("internal_error", "An unexpected error occurred", 500);
  }
});

// ---------------------------------------------------------------------------
// Load a boundary frame from S3 as base64 (if available)
// ---------------------------------------------------------------------------

async function loadFrameBase64(projectId: string, timestamp: number): Promise<string | null> {
  const bucket = Deno.env.get("AWS_S3_BUCKET");
  if (!bucket) return null;

  const frameName = `frame_${timestamp.toFixed(3).replace(".", "_")}.png`;
  const s3Key = `frames/${projectId}/${frameName}`;

  try {
    const response = await getS3Client().send(new GetObjectCommand({
      Bucket: bucket,
      Key: s3Key,
    }));

    if (!response.Body) {
      console.warn(`Frame S3 object has no body: ${s3Key}`);
      return null;
    }

    const bytes = new Uint8Array(await response.Body.transformToByteArray());
    if (bytes.length === 0) {
      console.warn(`Frame S3 object is empty (0 bytes): ${s3Key}`);
      return null;
    }
    console.log(`Loaded frame from S3: ${s3Key} (${bytes.length} bytes)`);
    return encodeBase64(bytes);
  } catch (err) {
    const errMsg = (err as Error).message ?? String(err);
    console.error(`Failed to load frame from S3: ${s3Key} — ${errMsg}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Ensure boundary frames are extracted before AI fill generation.
// Primary: enqueue a video.extract_frames job for the transcoder service
// (FFmpeg-based, precise). Fallback: Gemini video understanding API.
// ---------------------------------------------------------------------------

async function ensureFramesExtracted(
  serviceClient: ReturnType<typeof createServiceClient>,
  projectId: string,
  userId: string,
  videoS3Key: string | null,
  timestamps: number[],
): Promise<void> {
  if (!videoS3Key) {
    console.error("ensureFramesExtracted: no videoS3Key — cannot extract boundary frames");
    return;
  }

  const bucket = Deno.env.get("AWS_S3_BUCKET");
  if (!bucket) {
    console.error("ensureFramesExtracted: AWS_S3_BUCKET not set");
    return;
  }

  // Deduplicate timestamps based on 3-decimal precision
  const seenRounded = new Set<string>();
  const uniqueTimestamps: number[] = [];
  for (const ts of timestamps) {
    const rounded = ts.toFixed(3);
    if (!seenRounded.has(rounded)) {
      seenRounded.add(rounded);
      uniqueTimestamps.push(ts);
    }
  }

  // Check which frames are missing from S3
  const missing: number[] = [];
  for (const ts of uniqueTimestamps) {
    const frameName = `frame_${ts.toFixed(3).replace(".", "_")}.png`;
    const s3Key = `frames/${projectId}/${frameName}`;
    try {
      await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: s3Key }));
    } catch (err) {
      const httpStatus = (err as any)?.$metadata?.httpStatusCode;
      const errorName = (err as any)?.name;
      if (httpStatus === 404 || errorName === "NotFound") {
        missing.push(ts);
      } else {
        console.error("S3 HeadObject probe failed unexpectedly", { s3Key, errorName, httpStatus });
        return;
      }
    }
  }

  if (missing.length === 0) {
    console.log("All boundary frames already exist in S3");
    return;
  }

  console.log(`Need to extract ${missing.length} missing boundary frame(s) at timestamps: ${missing.join(", ")}`);

  // Tier 1: Use the transcoder service (FFmpeg-based, precise frame extraction)
  const transcoderOk = await requestTranscoderFrameExtraction(
    serviceClient, projectId, userId, videoS3Key, missing,
  );

  if (transcoderOk) return;

  // Tier 2: Fall back to Gemini video understanding (approximate but works without transcoder)
  console.warn("Transcoder frame extraction unavailable or timed out — falling back to Gemini");
  await extractFramesViaGemini(projectId, videoS3Key, bucket, missing);
}

// ---------------------------------------------------------------------------
// Tier 1: Enqueue a video.extract_frames job for the transcoder Docker service
// and poll for completion. The transcoder uses FFmpeg for precise extraction.
// ---------------------------------------------------------------------------

async function requestTranscoderFrameExtraction(
  serviceClient: ReturnType<typeof createServiceClient>,
  projectId: string,
  userId: string,
  videoS3Key: string,
  timestamps: number[],
): Promise<boolean> {
  const POLL_INTERVAL_MS = 3_000;
  const MAX_WAIT_MS = 60_000;

  // Insert a video.extract_frames job into the Supabase job_queue.
  // The transcoder service polls this table and processes these jobs via FFmpeg.
  const { data: frameJob, error: insertError } = await serviceClient
    .from("job_queue")
    .insert({
      project_id: projectId,
      user_id: userId,
      type: "video.extract_frames",
      status: "queued",
      payload: {
        video_s3_key: videoS3Key,
        timestamps,
      },
      priority: 5, // Higher priority (smaller number; 1 is highest) so frames are extracted before lower-priority work
    })
    .select("id")
    .single();

  if (insertError || !frameJob) {
    console.error("Failed to enqueue video.extract_frames job:", insertError?.message ?? "no data returned");
    return false;
  }

  console.log(`Enqueued video.extract_frames job ${frameJob.id} for ${timestamps.length} frame(s)`);

  // Poll for completion
  const startTime = Date.now();
  while (Date.now() - startTime < MAX_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const { data: jobStatus, error: statusError } = await serviceClient
      .from("job_queue")
      .select("status, error_message")
      .eq("id", frameJob.id)
      .single();

    if (statusError) {
      console.error(
        `Error while polling transcoder job status for job ${frameJob.id}:`,
        statusError.message ?? statusError,
      );
      return false;
    }
    if (jobStatus?.status === "complete") {
      console.log(`Frame extraction completed via transcoder (job ${frameJob.id})`);
      return true;
    }

    if (jobStatus?.status === "failed" || jobStatus?.status === "dead_letter") {
      console.error(`Transcoder frame extraction job failed: ${jobStatus.error_message}`);
      return false;
    }
  }

  // Timed out — mark the job as failed so the transcoder doesn't process a stale job
  console.warn(`Transcoder frame extraction timed out after ${MAX_WAIT_MS / 1000}s (job ${frameJob.id})`);
  await serviceClient
    .from("job_queue")
    .update({ status: "failed", error_message: "Timed out waiting for transcoder" })
    .eq("id", frameJob.id)
    .in("status", ["queued", "processing"]);

  return false;
}

// ---------------------------------------------------------------------------
// Tier 2 (fallback): Use Gemini video understanding to extract frames.
// Less precise than FFmpeg but works when the transcoder is unavailable.
// ---------------------------------------------------------------------------

async function extractFramesViaGemini(
  projectId: string,
  videoS3Key: string,
  bucket: string,
  timestamps: number[],
): Promise<void> {
  let accessToken: string;
  try {
    accessToken = await getVertexAccessToken();
  } catch (err) {
    console.error("extractFramesViaGemini: cannot get Vertex AI access token —", (err as Error).message);
    return;
  }
  const gcpProjectId = getGcpProjectId();
  const gcpRegion = getGcpRegion();

  let videoBase64: string;
  try {
    const videoResponse = await getS3Client().send(new GetObjectCommand({
      Bucket: bucket,
      Key: videoS3Key,
    }));
    if (!videoResponse.Body) {
      console.error("extractFramesViaGemini: video S3 object has no body");
      return;
    }
    const videoBytes = new Uint8Array(await videoResponse.Body.transformToByteArray());
    console.log(`Downloaded proxy video for Gemini fallback: ${videoS3Key} (${videoBytes.length} bytes)`);

    if (videoBytes.length > 20 * 1024 * 1024) {
      console.warn(`Proxy video too large for inline Gemini extraction (${videoBytes.length} bytes). Skipping.`);
      return;
    }

    videoBase64 = encodeBase64(videoBytes);
  } catch (err) {
    console.error(`Failed to download video for Gemini frame extraction: ${(err as Error).message}`);
    return;
  }

  for (const ts of timestamps) {
    try {
      const minutes = Math.floor(ts / 60);
      const seconds = Math.floor(ts % 60);
      const tsFormatted = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

      const geminiUrl = vertexGeminiUrl(gcpRegion, gcpProjectId, "gemini-2.0-flash");

      const geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inlineData: {
                  mimeType: "video/mp4",
                  data: videoBase64,
                },
              },
              {
                text: `Extract exactly the video frame at timestamp ${tsFormatted} (${ts.toFixed(3)} seconds). Return ONLY the frame as an image, no text.`,
              },
            ],
          }],
          generationConfig: {
            responseModalities: ["IMAGE", "TEXT"],
            temperature: 0,
          },
        }),
      });

      if (!geminiResponse.ok) {
        const body = await geminiResponse.text();
        console.error(`Gemini frame extraction failed for ts=${ts}: ${geminiResponse.status} — ${body}`);
        continue;
      }

      const geminiResult = await geminiResponse.json();

      let imageData: string | null = null;
      let imageMimeType = "image/png";
      const candidates = geminiResult.candidates ?? [];
      for (const candidate of candidates) {
        for (const part of candidate.content?.parts ?? []) {
          if (part.inlineData?.data) {
            imageData = part.inlineData.data;
            imageMimeType = part.inlineData.mimeType || "image/png";
            break;
          }
        }
        if (imageData) break;
      }

      if (!imageData) {
        console.warn(`Gemini did not return an image for timestamp ${ts}. Response: ${JSON.stringify(geminiResult).slice(0, 500)}`);
        continue;
      }

      const frameBytes = Uint8Array.from(atob(imageData), (c) => c.charCodeAt(0));
      const frameName = `frame_${ts.toFixed(3).replace(".", "_")}.png`;
      const s3Key = `frames/${projectId}/${frameName}`;

      await getS3Client().send(new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: frameBytes,
        ContentType: imageMimeType,
      }));

      console.log(`Extracted and uploaded frame: ${s3Key} (${frameBytes.length} bytes) via Gemini fallback`);
    } catch (err) {
      console.error(`Gemini frame extraction failed for ts=${ts}: ${(err as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// AI Fill Provider
// ---------------------------------------------------------------------------

interface FillRequest {
  projectId: string;
  editDecisionId: string;
  gapIndex: number;
  startTime: number;
  duration: number;
  sourceVideoKey?: string | null;
  model?: string | null;
  firstFrameBase64?: string | null;
  lastFrameBase64?: string | null;
  prompt?: string | null;
  audioPrompt?: string | null;
}

interface FillResponse {
  s3_key: string;
  provider: string;
  model: string;
  quality_score: number;
}

async function generateAiFill(request: FillRequest): Promise<FillResponse> {
  const model = request.model ?? "veo3.1-fast";
  return await generateVeoFill(request, model);
}

async function generateVeoFill(request: FillRequest, model: string): Promise<FillResponse> {
  const accessToken = await getVertexAccessToken();
  const gcpProjectId = getGcpProjectId();
  const gcpRegion = getGcpRegion();

  // Map our model names to Gemini API model IDs (use -preview suffix)
  const MODEL_API_IDS: Record<string, string> = {
    "veo2":                  "veo-2.0-generate-preview",
    "veo3.1-fast":           "veo-3.1-fast-generate-preview",
    "veo3.1-fast-audio":     "veo-3.1-fast-generate-preview",
    "veo3.1-standard":       "veo-3.1-generate-preview",
    "veo3.1-standard-audio": "veo-3.1-generate-preview",
    "veo3-standard-audio":   "veo-3.0-generate-preview",
  };
  const apiModelId = MODEL_API_IDS[model] ?? "veo-2.0-generate-preview";
  const includeAudio = model.endsWith("-audio");

  // Build the instance with optional first/last frame conditioning
  const defaultPrompt = `Smooth transition video clip, ${request.duration} seconds, seamless continuity, natural head movement`;
  let promptText = request.prompt
    ? `${request.prompt}, ${request.duration} seconds`
    : defaultPrompt;
  if (includeAudio && request.audioPrompt) {
    promptText += `. Audio: ${request.audioPrompt}`;
  }
  const instance: Record<string, unknown> = {
    prompt: promptText,
  };

  // predictLongRunning is Vertex AI-style and requires bytesBase64Encoded format.
  // Do NOT use inlineData here — it is rejected with a 400 error.
  if (request.firstFrameBase64) {
    instance.image = {
      mimeType: "image/png",
      bytesBase64Encoded: request.firstFrameBase64,
    };
    console.log("Using first frame conditioning for fill generation");
  }

  if (request.lastFrameBase64) {
    instance.lastFrame = {
      mimeType: "image/png",
      bytesBase64Encoded: request.lastFrameBase64,
    };
    console.log("Using last frame conditioning for fill generation");
  }

  if (!request.firstFrameBase64 && !request.lastFrameBase64) {
    console.error("WARNING: No frame conditioning provided — Veo will generate from text prompt only. Output will NOT match source video.");
  } else {
    console.log(`Frame conditioning: first=${!!request.firstFrameBase64}, last=${!!request.lastFrameBase64}`);
  }

  const parameters: Record<string, unknown> = {
    sampleCount: 1,
    durationSeconds: request.duration,
    aspectRatio: "16:9",
  };

  // Only pass generateAudio for models that support it (audio variants)
  if (includeAudio) {
    parameters.generateAudio = true;
  }

  const generateUrl = vertexVeoUrl(gcpRegion, gcpProjectId, apiModelId);
  console.log(`Using Vertex AI endpoint: ${generateUrl}`);

  const generateResponse = await fetch(generateUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      instances: [instance],
      parameters,
    }),
  });

  if (!generateResponse.ok) {
    const body = await generateResponse.text();
    throw new Error(`Veo generation request failed (${generateResponse.status}): ${body}`);
  }

  const operation = await generateResponse.json();
  const operationName = operation.name;

  // Poll for completion (up to 5 minutes)
  const maxWaitMs = 300_000;
  const pollIntervalMs = 5_000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

    const pollUrl = vertexPollUrl(gcpRegion, operationName);
    const pollResponse = await fetch(pollUrl, {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });

    if (!pollResponse.ok) {
      const body = await pollResponse.text();
      throw new Error(`Veo poll failed (${pollResponse.status}): ${body}`);
    }

    const pollResult = await pollResponse.json();
    if (pollResult.done) {
      const response = pollResult.response ?? pollResult.result;
      const generatedSamples =
        response?.generateVideoResponse?.generatedSamples ??
        response?.generatedSamples ??
        [];
      const videoUri = generatedSamples[0]?.video?.uri;
      if (!videoUri) {
        console.error("Veo completed but no video URI found. Full response:", JSON.stringify(pollResult));
        throw new Error("Veo completed but returned no video URI");
      }

      // Download the generated video and upload to S3
      const s3Key = `ai-fills/${request.projectId}/${request.editDecisionId}/gap_${request.gapIndex}_${request.duration}s.mp4`;

      // Convert gs:// URIs to HTTPS for download
      let downloadUrl = videoUri;
      if (videoUri.startsWith("gs://")) {
        const gcsPath = videoUri.slice(5); // strip "gs://"
        const slashIdx = gcsPath.indexOf("/");
        const gcsBucket = gcsPath.slice(0, slashIdx);
        const gcsObject = encodeURIComponent(gcsPath.slice(slashIdx + 1));
        downloadUrl = `https://storage.googleapis.com/storage/v1/b/${gcsBucket}/o/${gcsObject}?alt=media`;
      }

      let videoResponse = await fetch(downloadUrl, {
        headers: { "Authorization": `Bearer ${accessToken}` },
      });
      if (!videoResponse.ok) {
        // Retry without auth in case the URI is a signed URL
        console.warn(`Video download with bearer auth failed (${videoResponse.status}), retrying without auth`);
        videoResponse = await fetch(downloadUrl);
      }
      if (!videoResponse.ok) {
        const errBody = await videoResponse.text().catch(() => "");
        console.error("All video download attempts failed. URI:", videoUri, "Status:", videoResponse.status, "Body:", errBody);
        throw new Error(`Failed to download generated video (${videoResponse.status}): ${errBody}`);
      }
      const videoBytes = new Uint8Array(await videoResponse.arrayBuffer());

      // Upload to S3
      const bucket = Deno.env.get("AWS_S3_BUCKET");
      if (bucket) {
        await getS3Client().send(new PutObjectCommand({
          Bucket: bucket,
          Key: s3Key,
          Body: videoBytes,
          ContentType: "video/mp4",
        }));
      }

      return {
        s3_key: s3Key,
        provider: "veo",
        model,
        quality_score: request.firstFrameBase64 ? 0.95 : 0.90,
      };
    }
  }

  throw new Error(`Veo generation timed out after ${maxWaitMs / 1000}s`);
}

// ---------------------------------------------------------------------------
// Helper: mark job + edit_decision as failed
// ---------------------------------------------------------------------------

async function failJob(
  serviceClient: ReturnType<typeof createServiceClient>,
  jobId: string,
  editDecisionId: string,
  message: string,
  preview = false,
) {
  await serviceClient
    .from("job_queue")
    .update({
      status: "failed",
      error_message: message,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  await serviceClient
    .from("edit_decisions")
    .update({ status: "failed" })
    .eq("id", editDecisionId);

  if (!preview) {
    const { data: ed } = await serviceClient
      .from("edit_decisions")
      .select("project_id")
      .eq("id", editDecisionId)
      .single();

    if (ed?.project_id) {
      await serviceClient
        .from("projects")
        .update({ status: "failed", error_message: message })
        .eq("id", ed.project_id);
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: refund credits on any failure path
// ---------------------------------------------------------------------------

async function refundOnFailure(
  serviceClient: ReturnType<typeof createServiceClient>,
  creditTransactionId: string | null,
) {
  if (!creditTransactionId) return;
  try {
    const { data: refundResult, error: refundError } = await serviceClient
      .rpc("refund_credits", { p_transaction_id: creditTransactionId });
    if (refundError) {
      console.error("Credit refund RPC error:", refundError);
    } else {
      const r = refundResult?.[0] ?? refundResult;
      console.log(`Refunded ${r?.out_credits_refunded ?? 0} credits for failed generation (txn: ${creditTransactionId})`);
    }
  } catch (refundErr) {
    console.error("Credit refund failed:", refundErr);
  }
}
