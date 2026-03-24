import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

export const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
);

export interface ExportJobRow {
  id: string;
  project_id: string;
  user_id: string;
  type: string;
  payload: {
    project_id?: string;
    edit_decision_id: string;
    crossfade_duration?: number;
  };
  status: string;
  attempts: number;
  max_attempts: number;
}

export async function pollQueuedJobs(limit: number): Promise<ExportJobRow[]> {
  const { data, error } = await supabase
    .from("job_queue")
    .select("id, project_id, user_id, type, payload, status, attempts, max_attempts")
    .eq("type", "video.export")
    .eq("status", "queued")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    log("error", "Failed to poll job_queue", { error: error.message });
    return [];
  }
  return (data as ExportJobRow[]) || [];
}

export async function claimJob(jobId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("job_queue")
    .update({
      status: "processing",
      started_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "queued")
    .select("id");

  if (error) {
    log("error", "Failed to claim job", { job_id: jobId, error: error.message });
    return false;
  }
  return (data?.length ?? 0) > 0;
}

export async function incrementAttempts(jobId: string): Promise<void> {
  const { data } = await supabase
    .from("job_queue")
    .select("attempts")
    .eq("id", jobId)
    .single();
  if (data) {
    await supabase
      .from("job_queue")
      .update({ attempts: data.attempts + 1 })
      .eq("id", jobId);
  }
}

export async function updateJobProgress(jobId: string, percent: number): Promise<void> {
  await supabase
    .from("job_queue")
    .update({ progress_percent: Math.min(100, Math.max(0, Math.round(percent))) })
    .eq("id", jobId);
}

export async function completeJob(jobId: string): Promise<void> {
  await supabase
    .from("job_queue")
    .update({
      status: "complete",
      progress_percent: 100,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

export async function failJob(jobId: string, errorMessage: string): Promise<void> {
  await supabase
    .from("job_queue")
    .update({
      status: "failed",
      error_message: errorMessage.slice(0, 2000),
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

// ---------------------------------------------------------------------------
// DB query / update helpers
// ---------------------------------------------------------------------------

export interface EditDecisionRow {
  id: string;
  project_id: string;
  edl_json: EdlEntry[] | CutBasedEdlEntry[];
  total_fill_seconds: number;
  credits_charged: number;
  status: string;
  credit_transaction_id: string | null;
}

export interface EdlEntry {
  type: "source" | "fill";
  start?: number;
  end?: number;
  s3_key?: string;
  duration?: number;
}

/** Cut-based EDL entry as stored by project-edl: describes a cut in the original video. */
export interface CutBasedEdlEntry {
  start: number;
  end: number;
  type: string;            // "silence", "manual", "gap", etc.
  fill_duration: number;
  model?: string;
  existing_fill_s3_key?: string;
  existing_fill_s3_keys?: string[];
  prompt?: string;
}

export async function getEditDecision(editDecisionId: string): Promise<EditDecisionRow> {
  const { data, error } = await supabase
    .from("edit_decisions")
    .select("*")
    .eq("id", editDecisionId)
    .single();

  if (error || !data) {
    throw new Error(`Failed to fetch edit_decision ${editDecisionId}: ${error?.message}`);
  }
  return data as EditDecisionRow;
}

export interface AiFillRow {
  id: string;
  edit_decision_id: string;
  gap_index: number;
  s3_key: string | null;
  method: string;
  quality_score: number | null;
  duration: number | null;
}

export async function getAiFills(editDecisionId: string): Promise<AiFillRow[]> {
  const { data, error } = await supabase
    .from("ai_fills")
    .select("id, edit_decision_id, gap_index, s3_key, method, quality_score, duration")
    .eq("edit_decision_id", editDecisionId)
    .order("gap_index", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch ai_fills: ${error.message}`);
  }
  return (data as AiFillRow[]) || [];
}

export async function getUserTier(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("users")
    .select("tier")
    .eq("id", userId)
    .single();

  if (error || !data) {
    return "free";
  }
  return data.tier || "free";
}

export async function getSourceVideoS3Key(projectId: string): Promise<string> {
  const { data, error } = await supabase
    .from("videos")
    .select("s3_key")
    .eq("project_id", projectId)
    .single();

  if (error || !data?.s3_key) {
    throw new Error(`Failed to get source video s3_key for project ${projectId}: ${error?.message}`);
  }
  return data.s3_key;
}

export interface FillSummary {
  total_gaps: number;
  ai_fills: number;
  crossfades: number;
  hard_cuts: number;
  credits_used: number;
  credits_refunded: number;
}

export async function insertExport(params: {
  projectId: string;
  editDecisionId: string;
  s3Key: string;
  format: string;
  resolution: string;
  duration: number;
  fileSizeBytes: number;
  watermarked: boolean;
  fillSummary: FillSummary;
  downloadUrl: string;
}): Promise<string> {
  const { data, error } = await supabase
    .from("exports")
    .insert({
      project_id: params.projectId,
      edit_decision_id: params.editDecisionId,
      s3_key: params.s3Key,
      format: params.format,
      resolution: params.resolution,
      duration: params.duration,
      file_size_bytes: params.fileSizeBytes,
      watermarked: params.watermarked,
      fill_summary_json: params.fillSummary,
      download_url: params.downloadUrl,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert export: ${error?.message}`);
  }
  return data.id;
}

export async function updateEditDecisionStatus(editDecisionId: string, status: string): Promise<void> {
  await supabase
    .from("edit_decisions")
    .update({ status })
    .eq("id", editDecisionId);
}

export async function updateProjectStatus(projectId: string, status: string): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .update({ status })
    .eq("id", projectId);

  if (error) {
    throw new Error(`Failed to update project ${projectId} status: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(level: string, msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));
}
