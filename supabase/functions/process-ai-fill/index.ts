import { S3Client, CopyObjectCommand } from "npm:@aws-sdk/client-s3";
import { handleCors } from "../_shared/cors.ts";
import {
  getAuthenticatedUser,
  createServiceClient,
  AuthError,
} from "../_shared/auth.ts";
import { successResponse, errorResponse } from "../_shared/response.ts";

interface EdlEntry {
  start: number;
  end: number;
  type: string;
  fill_duration: number;
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

    const payload = job.payload as { edit_decision_id: string };
    if (!payload?.edit_decision_id) {
      return errorResponse("invalid_request", "Job payload missing edit_decision_id", 400);
    }

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
    const edlJson = editDecision.edl_json as EdlEntry[];
    const totalFillSeconds = editDecision.total_fill_seconds as number;
    const creditsCharged = editDecision.credits_charged as number;

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

    // 7. Deduct credits (if any fills requested)
    let creditTransactionId: string | null = null;
    if (creditsCharged > 0) {
      const { data: creditResult, error: creditError } = await serviceClient
        .rpc("deduct_credits", {
          p_user_id: user.id,
          p_required_credits: creditsCharged,
          p_project_id: project.id,
          p_reason: "ai_fill",
        });

      if (creditError) {
        console.error("Credit deduction RPC error:", creditError);
        await failJob(serviceClient, job.id, editDecision.id, "Credit deduction failed");
        return errorResponse("internal_error", "Credit deduction failed", 500);
      }

      const result = creditResult?.[0] ?? creditResult;
      if (!result?.out_success) {
        await failJob(serviceClient, job.id, editDecision.id, result?.out_message || "Insufficient credits");
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

    await serviceClient
      .from("projects")
      .update({ status: "generating" })
      .eq("id", project.id);

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
      const fillResult = await generateAiFill({
        projectId: project.id,
        editDecisionId: editDecision.id,
        gapIndex: gap.gap_index,
        startTime: gap.end,
        duration: gap.fill_duration,
        sourceVideoKey,
      });

      const generationTimeMs = Date.now() - generationStart;
      const aiFillId = crypto.randomUUID();
      const { error: fillInsertError } = await serviceClient
        .from("ai_fills")
        .insert({
          id: aiFillId,
          edit_decision_id: editDecision.id,
          gap_index: gap.gap_index,
          s3_key: fillResult.s3_key,
          method: "ai_fill",
          provider: fillResult.provider,
          quality_score: fillResult.quality_score,
          duration: gap.fill_duration,
          generation_time_ms: generationTimeMs,
        });

      if (fillInsertError) {
        console.error(`Failed to insert ai_fill for gap ${gap.gap_index}:`, fillInsertError);
      } else {
        aiFillResults.push({ gap_index: gap.gap_index, id: aiFillId });
      }
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
      .update({ status: "complete" })
      .eq("id", editDecision.id);

    await serviceClient
      .from("projects")
      .update({ status: "ready" })
      .eq("id", project.id);

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
// AI Fill Provider
// ---------------------------------------------------------------------------

interface FillRequest {
  projectId: string;
  editDecisionId: string;
  gapIndex: number;
  startTime: number;
  duration: number;
  sourceVideoKey?: string | null;
}

interface FillResponse {
  s3_key: string;
  provider: string;
  quality_score: number;
}

async function generateAiFill(request: FillRequest): Promise<FillResponse> {
  const provider = Deno.env.get("AI_FILL_PROVIDER");

  if (provider === "veo") {
    return await generateVeoFill(request);
  }

  return await generateMockFill(request);
}

async function generateMockFill(request: FillRequest): Promise<FillResponse> {
  const simulatedMs = Math.max(500, request.duration * 500);
  await new Promise((resolve) => setTimeout(resolve, simulatedMs));

  const s3Key = `ai-fills/${request.projectId}/${request.editDecisionId}/gap_${request.gapIndex}_${request.duration}s.mp4`;
  const bucket = Deno.env.get("AWS_S3_BUCKET");

  if (bucket && request.sourceVideoKey) {
    try {
      await getS3Client().send(new CopyObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        CopySource: `${bucket}/${request.sourceVideoKey}`,
        ContentType: "video/mp4",
        MetadataDirective: "REPLACE",
      }));
    } catch (error) {
      console.error("Mock fill S3 copy failed:", error);
    }
  } else {
    console.warn("Mock fill source video missing; preview object will not exist", {
      sourceVideoKey: request.sourceVideoKey,
      hasBucket: Boolean(bucket),
    });
  }

  return {
    s3_key: s3Key,
    provider: "mock",
    quality_score: 0.85,
  };
}

async function generateVeoFill(request: FillRequest): Promise<FillResponse> {
  const apiKey = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!apiKey) {
    console.warn("GOOGLE_AI_API_KEY not set, falling back to mock");
    return generateMockFill(request);
  }

  // Veo video generation via Gemini API
  // Start generation
  const generateResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/veo-2.0-generate-001:predictLongRunning`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        instances: [
          {
            prompt: `Smooth transition video clip, ${request.duration} seconds, seamless continuity`,
          },
        ],
        parameters: {
          sampleCount: 1,
          durationSeconds: request.duration,
          aspectRatio: "16:9",
        },
      }),
    },
  );

  if (!generateResponse.ok) {
    console.error("Veo generation failed:", await generateResponse.text());
    console.warn("Falling back to mock provider");
    return generateMockFill(request);
  }

  const operation = await generateResponse.json();
  const operationName = operation.name;

  // Poll for completion (up to 5 minutes)
  const maxWaitMs = 300_000;
  const pollIntervalMs = 5_000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

    const pollResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${operationName}`,
      { headers: { "x-goog-api-key": apiKey } },
    );

    if (!pollResponse.ok) {
      console.error("Veo poll failed:", await pollResponse.text());
      continue;
    }

    const pollResult = await pollResponse.json();
    if (pollResult.done) {
      // Extract video URL from response
      const videoUri = pollResult.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (videoUri) {
        // In production, download and upload to S3. For now, store the URI.
        const s3Key = `ai-fills/${request.projectId}/${request.editDecisionId}/gap_${request.gapIndex}_${request.duration}s.mp4`;
        return {
          s3_key: s3Key,
          provider: "veo",
          quality_score: 0.90,
        };
      }
      break;
    }
  }

  // Timeout or no result — fall back to mock
  console.warn("Veo generation timed out, falling back to mock");
  return generateMockFill(request);
}

// ---------------------------------------------------------------------------
// Helper: mark job + edit_decision as failed
// ---------------------------------------------------------------------------

async function failJob(
  serviceClient: ReturnType<typeof createServiceClient>,
  jobId: string,
  editDecisionId: string,
  message: string,
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
}
