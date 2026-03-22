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
      // Poll for the next queued ai.fill job for this user
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

    // Link credit transaction to edit decision
    if (creditTransactionId) {
      await serviceClient
        .from("edit_decisions")
        .update({ credit_transaction_id: creditTransactionId })
        .eq("id", editDecision.id);
    }

    // 8. Update edit decision status to 'generating'
    await serviceClient
      .from("edit_decisions")
      .update({ status: "generating" })
      .eq("id", editDecision.id);

    // Update project status so realtime picks it up
    await serviceClient
      .from("projects")
      .update({ status: "generating" })
      .eq("id", project.id);

    // 9. Process each gap that has a fill
    const fillGaps = edlJson
      .map((entry, index) => ({ ...entry, gap_index: index }))
      .filter((entry) => entry.fill_duration > 0);

    const totalGaps = fillGaps.length;
    const aiFillResults: Array<{ gap_index: number; id: string }> = [];

    for (let i = 0; i < fillGaps.length; i++) {
      const gap = fillGaps[i];

      // Update progress
      const progressPercent = Math.round(((i) / totalGaps) * 100);
      await serviceClient
        .from("job_queue")
        .update({ progress_percent: progressPercent })
        .eq("id", job.id);

      // Generate AI fill for this gap
      const generationStart = Date.now();

      let fillResult: FillResponse;
      try {
        fillResult = await generateAiFill({
          projectId: project.id,
          editDecisionId: editDecision.id,
          gapIndex: gap.gap_index,
          startTime: gap.end, // fill starts where the cut ends
          duration: gap.fill_duration,
        });
      } catch (fillErr) {
        const msg = `AI fill generation failed for gap ${gap.gap_index}: ${(fillErr as Error).message}`;
        console.error(msg);
        await failJob(serviceClient, job.id, editDecision.id, msg);
        return errorResponse("ai_generation_failed", msg, 502);
      }

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
        const msg = `Failed to persist ai_fill for gap ${gap.gap_index}: ${fillInsertError.message}`;
        console.error(msg);
        await failJob(serviceClient, job.id, editDecision.id, msg);
        return errorResponse("internal_error", msg, 500);
      }

      aiFillResults.push({ gap_index: gap.gap_index, id: aiFillId });
    }

    // 10. Mark complete
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

  throw new Error(
    `AI_FILL_PROVIDER is "${provider ?? "unset"}" — no valid provider configured. ` +
    `Set AI_FILL_PROVIDER to "veo" and ensure GOOGLE_AI_API_KEY is set.`,
  );
}

async function generateVeoFill(request: FillRequest): Promise<FillResponse> {
  const apiKey = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!apiKey) {
    throw new Error("GOOGLE_AI_API_KEY is not set — cannot call Veo API");
  }

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

    const pollResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${operationName}`,
      { headers: { "x-goog-api-key": apiKey } },
    );

    if (!pollResponse.ok) {
      const body = await pollResponse.text();
      throw new Error(`Veo poll failed (${pollResponse.status}): ${body}`);
    }

    const pollResult = await pollResponse.json();
    if (pollResult.done) {
      const videoUri = pollResult.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!videoUri) {
        throw new Error("Veo completed but returned no video URI");
      }

      const s3Key = `ai-fills/${request.projectId}/${request.editDecisionId}/gap_${request.gapIndex}_${request.duration}s.mp4`;
      return {
        s3_key: s3Key,
        provider: "veo",
        quality_score: 0.90,
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
