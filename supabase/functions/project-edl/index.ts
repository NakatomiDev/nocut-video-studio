import { handleCors } from "../_shared/cors.ts";
import {
  getAuthenticatedUser,
  createServiceClient,
  AuthError,
} from "../_shared/auth.ts";
import { successResponse, errorResponse } from "../_shared/response.ts";
import {
  MAX_FILL_DURATION,
  MODEL_CREDITS_PER_SEC,
  DEFAULT_AI_FILL_MODEL,
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
    const { project_id, gaps, output_format, output_resolution, model: requestedModel } = body as {
      project_id: string;
      gaps: Array<{
        pre_cut_timestamp: number;
        post_cut_timestamp: number;
        fill_duration?: number;
        model?: string;
        type?: string;
        existing_fill_s3_key?: string;
        prompt?: string;
      }>;
      output_format?: string;
      output_resolution?: string;
      model?: string;
    };

    // Validate model selection
    const model: AiFillModel = (requestedModel && requestedModel in MODEL_CREDITS_PER_SEC)
      ? requestedModel as AiFillModel
      : DEFAULT_AI_FILL_MODEL;

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

    // 3. Build EDL entries — export is assembly-only, no credit charges
    let totalFillSeconds = 0;
    const edlJson: Array<{
      start: number;
      end: number;
      type: string;
      fill_duration: number;
      model: string;
      existing_fill_s3_key?: string;
      prompt?: string;
    }> = [];

    for (let i = 0; i < gaps.length; i++) {
      const gap = gaps[i];
      const gapDuration = Math.abs(gap.post_cut_timestamp - gap.pre_cut_timestamp);

      // Resolve fill duration
      let fillDuration = 0;
      if (typeof gap.fill_duration === "number") {
        fillDuration = Math.min(Math.max(0, gap.fill_duration), maxFill);
      }

      // Only include fill if there's an existing fill to reuse
      if (fillDuration > 0 && !gap.existing_fill_s3_key) {
        // No pre-generated fill — treat as cut-only
        fillDuration = 0;
      }

      if (fillDuration > maxFill) {
        return errorResponse(
          "tier_limit_exceeded",
          `Gap at index ${i} fill_duration ${fillDuration}s exceeds ${tier} tier max of ${maxFill}s per gap.`,
          403,
        );
      }

      // Resolve per-gap model
      const gapModel: AiFillModel = (gap.model && gap.model in MODEL_CREDITS_PER_SEC)
        ? gap.model as AiFillModel
        : model;

      totalFillSeconds += fillDuration;

      const entry: typeof edlJson[number] = {
        start: gap.pre_cut_timestamp,
        end: gap.post_cut_timestamp,
        type: gap.type ?? "gap",
        fill_duration: fillDuration,
        model: gapModel,
      };
      if (gap.existing_fill_s3_key) {
        entry.existing_fill_s3_key = gap.existing_fill_s3_key;
      }
      if (gap.prompt) {
        entry.prompt = gap.prompt.slice(0, 200).trim();
      }
      edlJson.push(entry);
    }

    // 4. Create edit_decisions row — no credits charged (export is free)
    const { data: editDecision, error: edError } = await serviceClient
      .from("edit_decisions")
      .insert({
        project_id,
        edl_json: edlJson,
        total_fill_seconds: totalFillSeconds,
        credits_charged: 0,
        model,
        credits_per_sec: 0,
        status: "pending",
        credit_transaction_id: null,
      })
      .select("id")
      .single();

    if (edError || !editDecision) {
      console.error("Failed to create edit_decision:", edError);
      return errorResponse("internal_error", "Failed to create edit decision", 500);
    }

    // 5. Create job_queue row — assembly job, not AI generation
    const priority = tier === "business" ? 1 : tier === "pro" ? 5 : 10;

    const { data: jobRow, error: jobError } = await serviceClient
      .from("job_queue")
      .insert({
        project_id,
        user_id: user.id,
        type: "video.export",
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
      })
      .select("id")
      .single();

    if (jobError || !jobRow) {
      console.error("Failed to create job:", jobError);
      return errorResponse("internal_error", "Failed to queue processing job", 500);
    }

    // 6. Update project status to exporting (assembly only)
    await serviceClient
      .from("projects")
      .update({ status: "exporting" })
      .eq("id", project_id);

    // 7. Invoke export-video edge function to process the assembly job
    if (jobRow?.id) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      try {
        const exportRes = await fetch(`${supabaseUrl}/functions/v1/export-video`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ job_id: jobRow.id }),
        });
        if (!exportRes.ok) {
          const body = await exportRes.text();
          console.error(`export-video returned ${exportRes.status}: ${body}`);
        }
      } catch (err) {
        console.error("Failed to invoke export-video:", err);
      }
    }

    return successResponse({
      edit_decision_id: editDecision.id,
      job_id: jobRow.id,
      model,
      credits_charged: 0,
      edl: edlJson,
    });
  } catch (err) {
    console.error("Unhandled error in project-edl:", err);
    return errorResponse("internal_error", "An unexpected error occurred", 500);
  }
});
