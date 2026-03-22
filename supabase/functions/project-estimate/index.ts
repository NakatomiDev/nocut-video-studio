import { handleCors } from "../_shared/cors.ts";
import { getAuthenticatedUser, AuthError } from "../_shared/auth.ts";
import { successResponse, errorResponse } from "../_shared/response.ts";
import {
  getCreditBalance,
  estimateGaps,
  MODEL_CREDITS_PER_SEC,
  DEFAULT_AI_FILL_MODEL,
  type AiFillModel,
} from "../_shared/credits.ts";

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
    const { gaps, model: requestedModel } = body as {
      gaps: Array<{ pre_cut_timestamp: number; post_cut_timestamp: number }>;
      model?: string;
    };

    if (!Array.isArray(gaps) || gaps.length === 0) {
      return errorResponse("invalid_request", "gaps must be a non-empty array", 400);
    }

    const model: AiFillModel = (requestedModel && requestedModel in MODEL_CREDITS_PER_SEC)
      ? requestedModel as AiFillModel
      : DEFAULT_AI_FILL_MODEL;

    // Validate each gap has required fields
    for (let i = 0; i < gaps.length; i++) {
      const g = gaps[i];
      if (typeof g.pre_cut_timestamp !== "number" || typeof g.post_cut_timestamp !== "number") {
        return errorResponse(
          "invalid_request",
          `Gap at index ${i} must have numeric pre_cut_timestamp and post_cut_timestamp`,
          400,
        );
      }
    }

    const { estimates, total_credits, credits_per_sec } = estimateGaps(gaps, undefined, model);

    // Get user's current balance
    const balance = await getCreditBalance(supabaseClient, user.id);

    return successResponse({
      model,
      credits_per_sec,
      total_credits_required: total_credits,
      credits_available: balance.total,
      sufficient: balance.total >= total_credits,
      gap_estimates: estimates,
      available_models: Object.entries(MODEL_CREDITS_PER_SEC).map(([m, cps]) => ({
        model: m,
        credits_per_sec: cps,
      })),
    });
  } catch (err) {
    console.error("Unhandled error in project-estimate:", err);
    return errorResponse("internal_error", "An unexpected error occurred", 500);
  }
});
