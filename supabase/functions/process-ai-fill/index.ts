import { S3Client, CopyObjectCommand, PutObjectCommand, GetObjectCommand } from "npm:@aws-sdk/client-s3";
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

    // Use server-calculated credits for deduction
    const creditsToDeduct = serverCalculatedCredits;

    let creditTransactionId: string | null = null;
    if (creditsToDeduct > 0) {
      const { data: creditResult, error: creditError } = await serviceClient
        .rpc("deduct_credits", {
          p_user_id: user.id,
          p_required_credits: creditsToDeduct,
          p_project_id: project.id,
          p_reason: "ai_fill",
        });

      if (creditError) {
        console.error("Credit deduction RPC error:", creditError);
        await failJob(serviceClient, job.id, editDecision.id, "Credit deduction failed", isPreview);
        return errorResponse("internal_error", "Credit deduction failed", 500);
      }

      const result = creditResult?.[0] ?? creditResult;
      if (!result?.out_success) {
        await failJob(serviceClient, job.id, editDecision.id, result?.out_message || "Insufficient credits", isPreview);
        return errorResponse("payment_required", result?.out_message || "Insufficient credits", 402);
      }

      creditTransactionId = result.out_transaction_id;
    }

    if (creditTransactionId) {
      await serviceClient
        .from("edit_decisions")
        .update({ credit_transaction_id: creditTransactionId })
        .eq("id", editDecision.id);
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
        // Try to load boundary frames from S3 (extracted by transcoder service)
        const firstFrameBase64 = await loadFrameBase64(project.id, gap.end);
        const lastFrameBase64 = await loadFrameBase64(project.id, gap.end + gap.fill_duration);

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
          });
        } catch (fillErr) {
          const msg = `AI fill generation failed for gap ${gap.gap_index}: ${(fillErr as Error).message}`;
          console.error(msg);
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

    if (!response.Body) return null;

    const bytes = new Uint8Array(await response.Body.transformToByteArray());
    // Convert to base64
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } catch {
    // Frame not available — will generate without conditioning
    return null;
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
  const apiKey = Deno.env.get("GOOGLE_AI_API_KEY");

  if (!apiKey) {
    throw new Error("GOOGLE_AI_API_KEY is not set — cannot call Veo API");
  }

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
  const instance: Record<string, unknown> = {
    prompt: `Smooth transition video clip, ${request.duration} seconds, seamless continuity, natural head movement`,
  };

  if (request.firstFrameBase64) {
    instance.image = {
      inlineData: { mimeType: "image/png", data: request.firstFrameBase64 },
    };
    console.log("Using first frame conditioning for fill generation");
  }

  if (request.lastFrameBase64) {
    instance.lastFrame = {
      inlineData: { mimeType: "image/png", data: request.lastFrameBase64 },
    };
    console.log("Using last frame conditioning for fill generation");
  }

  const parameters: Record<string, unknown> = {
    sampleCount: 1,
    durationSeconds: request.duration,
    aspectRatio: "16:9",
  };

  if (includeAudio) {
    parameters.generateAudio = true;
  }

  // Always use Gemini API — it supports API keys and image conditioning
  const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${apiModelId}:predictLongRunning`;
  console.log(`Using Gemini API endpoint: ${generateUrl}`);

  const generateResponse = await fetch(generateUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
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

  const pollBaseUrl = `https://generativelanguage.googleapis.com/v1beta`;

  // Poll for completion (up to 5 minutes)
  const maxWaitMs = 300_000;
  const pollIntervalMs = 5_000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

    const pollResponse = await fetch(
      `${pollBaseUrl}/${operationName}`,
      { headers: { "x-goog-api-key": apiKey } },
    );

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
      
      // Try multiple download approaches
      let videoResponse = await fetch(`${videoUri}?key=${apiKey}`);
      if (!videoResponse.ok) {
        console.warn(`Video download with query key failed (${videoResponse.status}), retrying with header auth`);
        videoResponse = await fetch(videoUri, {
          headers: { "x-goog-api-key": apiKey },
        });
      }
      if (!videoResponse.ok) {
        console.warn(`Video download with header also failed (${videoResponse.status}), trying alt=media`);
        videoResponse = await fetch(`${videoUri}?alt=media&key=${apiKey}`);
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
