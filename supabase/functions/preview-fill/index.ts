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
  MAX_FILL_DURATION,
  TOPUP_PRODUCTS,
  type AiFillModel,
} from "../_shared/credits.ts";
import { Tier } from "../_shared/tier-limits.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "Only POST is allowed", 405);
  }

  try {
    // 1. Authenticate
    let user, supabaseClient;
    try {
      const auth = await getAuthenticatedUser(req);
      user = auth.user;
      supabaseClient = auth.supabaseClient;
    } catch (err) {
      if (err instanceof AuthError) {
        return errorResponse("unauthorized", err.message, 401);
      }
      throw err;
    }

    // 2. Parse request
    const body = await req.json();
    const { project_id, start, end, type, fill_duration, model: requestedModel, prompt: rawPrompt, audio_prompt: rawAudioPrompt } = body as {
      project_id: string;
      start: number;
      end: number;
      type: string;
      fill_duration: number;
      model?: string;
      prompt?: string;
      audio_prompt?: string;
    };

    const prompt = rawPrompt ? rawPrompt.slice(0, 200).trim() : undefined;
    const audioPrompt = rawAudioPrompt ? rawAudioPrompt.slice(0, 200).trim() : undefined;

    if (!project_id || typeof start !== "number" || typeof end !== "number" || typeof fill_duration !== "number") {
      return errorResponse("invalid_request", "project_id, start, end, and fill_duration are required", 400);
    }

    if (fill_duration <= 0) {
      return errorResponse("invalid_request", "fill_duration must be positive", 400);
    }

    const model: AiFillModel = (requestedModel && requestedModel in MODEL_CREDITS_PER_SEC)
      ? requestedModel as AiFillModel
      : DEFAULT_AI_FILL_MODEL;

    const serviceClient = createServiceClient();

    // 3. Verify project ownership
    const { data: project, error: projError } = await supabaseClient
      .from("projects")
      .select("id, user_id, status")
      .eq("id", project_id)
      .single();

    if (projError || !project) {
      return errorResponse("not_found", "Project not found", 404);
    }

    // 4. Get user tier and enforce fill duration limits
    const { data: userData, error: userError } = await supabaseClient
      .from("users")
      .select("tier")
      .eq("id", user.id)
      .single();

    if (userError || !userData) {
      return errorResponse("internal_error", "Could not fetch user tier", 500);
    }

    const tier = (userData.tier ?? "free") as Tier;
    const maxFill = MAX_FILL_DURATION[tier] ?? 1;

    if (fill_duration > maxFill) {
      return errorResponse(
        "tier_limit_exceeded",
        `Fill duration ${fill_duration}s exceeds ${tier} tier max of ${maxFill}s per gap.`,
        403,
      );
    }

    // 5. Calculate credits server-side
    const creditsPerSec = MODEL_CREDITS_PER_SEC[model] ?? 1;
    const totalCredits = fill_duration * creditsPerSec;

    // 6. Deduct credits atomically
    const { data: creditResult, error: creditError } = await serviceClient
      .rpc("deduct_credits", {
        p_user_id: user.id,
        p_required_credits: totalCredits,
        p_project_id: project_id,
        p_reason: "ai_fill",
      });

    if (creditError) {
      console.error("Credit deduction RPC error:", creditError);
      return errorResponse("internal_error", "Credit deduction failed", 500);
    }

    const result = creditResult?.[0] ?? creditResult;
    if (!result?.out_success) {
      return errorResponse("payment_required", result?.out_message ?? "Insufficient credits", 402, {
        credits_required: totalCredits,
        credits_available: result?.out_credits_remaining ?? 0,
        topup_options: Object.entries(TOPUP_PRODUCTS).map(([id, p]) => ({
          product_id: id,
          credits: p.credits,
          price: `$${(p.price_cents / 100).toFixed(2)}`,
          name: p.name,
        })),
      });
    }

    const creditTransactionId = result.out_transaction_id;

    // 7. Create edit_decisions row via service_role
    const edlJson = [{
      start,
      end,
      type: type ?? "gap",
      fill_duration,
      model,
      ...(prompt ? { prompt } : {}),
      ...(audioPrompt ? { audio_prompt: audioPrompt } : {}),
    }];

    const { data: editDecision, error: edError } = await serviceClient
      .from("edit_decisions")
      .insert({
        project_id,
        edl_json: edlJson,
        total_fill_seconds: fill_duration,
        credits_charged: totalCredits,
        model,
        credits_per_sec: creditsPerSec,
        status: "pending",
        credit_transaction_id: creditTransactionId,
      })
      .select("id")
      .single();

    if (edError || !editDecision) {
      console.error("Failed to create edit_decision:", edError);
      // Refund the credits we just deducted since we can't proceed
      await refundCredits(serviceClient, creditTransactionId);
      return errorResponse("internal_error", "Failed to create edit decision", 500);
    }

    // 8. Create job_queue row via service_role
    const priority = tier === "business" ? 1 : tier === "pro" ? 5 : 10;

    const { data: jobRow, error: jobError } = await serviceClient
      .from("job_queue")
      .insert({
        project_id,
        user_id: user.id,
        type: "ai.fill",
        payload: { edit_decision_id: editDecision.id, preview: true },
        status: "queued",
        priority,
        progress_percent: 0,
        attempts: 0,
        max_attempts: 3,
      })
      .select("id")
      .single();

    if (jobError || !jobRow) {
      console.error("Failed to create job:", jobError);
      // Refund credits since we can't queue the job
      await refundCredits(serviceClient, creditTransactionId);
      return errorResponse("internal_error", "Failed to queue preview job", 500);
    }

    return successResponse({
      job_id: jobRow.id,
      edit_decision_id: editDecision.id,
      credits_charged: totalCredits,
      credits_remaining: result.out_credits_remaining,
    });
  } catch (err) {
    console.error("Unhandled error in preview-fill:", err);
    return errorResponse("internal_error", "An unexpected error occurred", 500);
  }
});

// ---------------------------------------------------------------------------
// Helper: refund credits on failure
// ---------------------------------------------------------------------------
async function refundCredits(
  serviceClient: ReturnType<typeof createServiceClient>,
  transactionId: string,
) {
  try {
    const { data, error } = await serviceClient
      .rpc("refund_credits", { p_transaction_id: transactionId });
    if (error) {
      console.error("Credit refund RPC error:", error);
    } else {
      const r = data?.[0] ?? data;
      console.log(`Refunded ${r?.out_credits_refunded ?? 0} credits (txn: ${transactionId})`);
    }
  } catch (refundErr) {
    console.error("Credit refund failed:", refundErr);
  }
}
