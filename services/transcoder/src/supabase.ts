import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

export const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
);

export interface TranscodeJobRow {
  id: string;
  project_id: string;
  user_id: string;
  type: string;
  payload: { video_id: string; s3_key: string };
  status: string;
  attempts: number;
  max_attempts: number;
}

export async function pollQueuedJobs(limit: number): Promise<TranscodeJobRow[]> {
  const { data, error } = await supabase
    .from("job_queue")
    .select("id, project_id, user_id, type, payload, status, attempts, max_attempts")
    .eq("type", "video.transcode")
    .eq("status", "queued")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "Failed to poll job_queue", error: error.message }));
    return [];
  }
  return (data as TranscodeJobRow[]) || [];
}

export async function claimJob(jobId: string): Promise<boolean> {
  const { error } = await supabase
    .from("job_queue")
    .update({
      status: "processing",
      started_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "queued"); // Optimistic lock: only claim if still queued

  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "Failed to claim job", job_id: jobId, error: error.message }));
    return false;
  }
  return true;
}

export async function incrementAttempts(jobId: string): Promise<void> {
  const { error } = await supabase.rpc("increment_job_attempts", { job_id: jobId }).maybeSingle();
  // Fallback: if RPC doesn't exist, do a manual increment
  if (error) {
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
}

export async function updateJobProgress(jobId: string, percent: number): Promise<void> {
  const { error } = await supabase
    .from("job_queue")
    .update({ progress_percent: Math.min(100, Math.max(0, Math.round(percent))) })
    .eq("id", jobId);

  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "Failed to update progress", job_id: jobId, error: error.message }));
  }
}

export async function completeJob(jobId: string): Promise<void> {
  const { error } = await supabase
    .from("job_queue")
    .update({
      status: "complete",
      progress_percent: 100,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "Failed to complete job", job_id: jobId, error: error.message }));
  }
}

export async function failJob(jobId: string, errorMessage: string): Promise<void> {
  const { error } = await supabase
    .from("job_queue")
    .update({
      status: "failed",
      error_message: errorMessage.slice(0, 2000),
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "Failed to mark job failed", job_id: jobId, error: error.message }));
  }
}

export interface VideoResults {
  proxy_s3_key: string;
  waveform_s3_key: string;
  thumbnail_sprite_s3_key: string;
  duration: number;
  resolution: string;
}

export async function updateVideoResults(videoId: string, results: VideoResults): Promise<void> {
  const { error } = await supabase
    .from("videos")
    .update(results)
    .eq("id", videoId);

  if (error) {
    throw new Error(`Failed to update video ${videoId}: ${error.message}`);
  }
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

export async function enqueueDetectJob(
  projectId: string,
  userId: string,
  videoId: string,
  s3Key: string,
): Promise<void> {
  const { error } = await supabase
    .from("job_queue")
    .insert({
      project_id: projectId,
      user_id: userId,
      type: "video.detect",
      payload: { video_id: videoId, s3_key: s3Key },
    });

  if (error) {
    throw new Error(`Failed to enqueue detect job: ${error.message}`);
  }
}

export async function fetchUserTier(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("users")
    .select("tier")
    .eq("id", userId)
    .single();

  if (error || !data) {
    throw new Error(`Failed to fetch user tier for ${userId}: ${error?.message ?? "not found"}`);
  }
  return data.tier;
}
