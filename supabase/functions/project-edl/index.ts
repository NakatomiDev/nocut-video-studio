import { handleCors } from "../_shared/cors.ts";
import {
  getAuthenticatedUser,
  createServiceClient,
  AuthError,
} from "../_shared/auth.ts";
import { successResponse, errorResponse } from "../_shared/response.ts";
import {
  getCreditBalance,
  estimateGaps,
  MAX_FILL_DURATION,
  TOPUP_PRODUCTS,
} from "../_shared/credits.ts";
import { Tier } from "../_shared/tier-limits.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "Only POST is allowed", 405);
  }

  try {
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

    const body = await req.json();
    const { project_id, gaps, output_format, output_resolution } = body as {
      project_id: string;
      gaps: Array<{ pre_cut_timestamp: number; post_cut_timestamp: number }>;
      output_format?: string;
      output_resolution?: string;
    };

    if (!project_id) {
      return errorResponse("invalid_request", "project_id is required", 400);
    }
    if (!Array.isArray(gaps) || gaps.length === 0) {
      return errorResponse("invalid_request", "gaps must be a non-empty array", 400);
    }

    const serviceClient = createServiceClient();

    // 1. Verify project ownership and status
    const { data: project, error: projError } = await supabaseClient
      .from("projects")
      .select("id, user_id, status")
      .eq("id", project_id)
      .single();

    if (projError || !project) {
      return errorResponse("not_found", "Project not found", 404);
    }

    // 2. Get user tier
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

    // 3. Validate gap fill durations against tier limits
    for (let i = 0; i < gaps.length; i++) {
      const gapDuration = Math.abs(gaps[i].post_cut_timestamp - gaps[i].pre_cut_timestamp);
      const rawFill = Math.min(gapDuration * 0.5, 3.0);
      if (Math.ceil(rawFill) > maxFill) {
        return errorResponse(
          "tier_limit_exceeded",
          `Gap at index ${i} requires ${Math.ceil(rawFill)}s fill, but ${tier} tier max is ${maxFill}s per gap. Upgrade to Pro for up to 5s fills.`,
          403,
        );
      }
    }

    // 4. Calculate required credits
    const { estimates, total_credits } = estimateGaps(gaps, maxFill);

    // 5. Deduct credits atomically via Postgres function
    const { data: creditResult, error: creditError } = await serviceClient
      .rpc("deduct_credits", {
        p_user_id: user.id,
        p_required_credits: total_credits,
        p_project_id: project_id,
        p_reason: "ai_fill",
      });

    if (creditError) {
      console.error("Credit deduction RPC error:", creditError);
      return errorResponse("internal_error", "Credit deduction failed", 500);
    }

    const result = creditResult?.[0] ?? creditResult;
    if (!result?.out_success) {
      // Insufficient credits — return 402 with topup options
      return errorResponse("payment_required", result?.out_message ?? "Insufficient credits", 402, {
        credits_required: total_credits,
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
    const creditsRemaining = result.out_credits_remaining;

    // 6. Build EDL JSON
    const edlJson = estimates.map((est) => ({
      start: est.pre_cut_timestamp,
      end: est.post_cut_timestamp,
      type: "gap",
      fill_duration: est.fill_duration,
    }));

    const totalFillSeconds = estimates.reduce((sum, e) => sum + e.fill_duration, 0);

    // 7. Create edit_decisions row
    const { data: editDecision, error: edError } = await serviceClient
      .from("edit_decisions")
      .insert({
        project_id,
        edl_json: edlJson,
        total_fill_seconds: totalFillSeconds,
        credits_charged: total_credits,
        status: "pending",
        credit_transaction_id: creditTransactionId,
      })
      .select("id")
      .single();

    if (edError || !editDecision) {
      console.error("Failed to create edit_decision:", edError);
      return errorResponse("internal_error", "Failed to create edit decision", 500);
    }

    // 8. Create job_queue row
    const priority = tier === "business" ? 1 : tier === "pro" ? 5 : 10;

    const { error: jobError } = await serviceClient
      .from("job_queue")
      .insert({
        project_id,
        user_id: user.id,
        type: "ai.fill",
        payload: {
          edit_decision_id: editDecision.id,
          output_format: output_format ?? "mp4",
          output_resolution: output_resolution ?? "1080p",
        },
        status: "queued",
        priority,
        progress_percent: 0,
        attempts: 0,
        max_attempts: 3,
      });

    if (jobError) {
      console.error("Failed to create job:", jobError);
      return errorResponse("internal_error", "Failed to queue processing job", 500);
    }

    // 9. Update project status
    await serviceClient
      .from("projects")
      .update({ status: "generating" })
      .eq("id", project_id);

    // Estimate processing time: ~30s per second of fill (rough heuristic)
    const estimatedProcessingSeconds = totalFillSeconds * 30;

    return successResponse({
      edit_decision_id: editDecision.id,
      credits_charged: total_credits,
      credits_remaining: creditsRemaining,
      estimated_processing_seconds: estimatedProcessingSeconds,
      gap_estimates: estimates,
    });
  } catch (err) {
    console.error("Unhandled error in project-edl:", err);
    return errorResponse("internal_error", "An unexpected error occurred", 500);
  }
});
