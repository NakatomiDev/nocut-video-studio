/**
 * Entry point for the NoCut video export service.
 *
 * Polls the Supabase job_queue for 'video.export' jobs and assembles
 * final videos from source segments and AI fill clips.
 */

import { mkdir, rm, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";

import { config } from "./config.js";
import {
  pollQueuedJobs,
  claimJob,
  incrementAttempts,
  updateJobProgress,
  completeJob,
  failJob,
  getEditDecision,
  getAiFills,
  getUserTier,
  getSourceVideoS3Key,
  insertExport,
  updateEditDecisionStatus,
  updateProjectStatus,
  type ExportJobRow,
  type EdlEntry,
  type FillSummary,
} from "./supabase.js";
import { downloadFile, uploadFile, generateSignedDownloadUrl } from "./s3.js";
import { extractSegments, concatenateSegments, probeVideo, parseResolution } from "./assembler.js";
import { normalizeAudio } from "./audio.js";
import { applyWatermark } from "./watermark.js";

function log(level: string, msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));
}

let shutdown = false;

function handleSignal(signal: string): void {
  log("info", `Received ${signal}, shutting down...`);
  shutdown = true;
}

async function main(): Promise<void> {
  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("SIGINT", () => handleSignal("SIGINT"));

  log("info", "Exporter service starting", {
    poll_interval_ms: config.pollIntervalMs,
  });

  while (!shutdown) {
    try {
      const jobs = await pollQueuedJobs(1);
      if (jobs.length > 0) {
        await processJob(jobs[0]);
      } else {
        await sleep(config.pollIntervalMs);
      }
    } catch (err) {
      log("error", "Unhandled error in poll loop", {
        error: err instanceof Error ? err.message : String(err),
      });
      await sleep(config.pollIntervalMs);
    }
  }

  log("info", "Exporter service shut down");
}

async function processJob(job: ExportJobRow): Promise<void> {
  const jobId = job.id;
  const projectId = job.project_id;
  const userId = job.user_id;
  const editDecisionId = job.payload.edit_decision_id;

  const ctx = { job_id: jobId, project_id: projectId, edit_decision_id: editDecisionId };
  log("info", "Processing export job", ctx);

  // Claim the job (optimistic lock)
  const claimed = await claimJob(jobId);
  if (!claimed) {
    log("info", "Job already claimed by another worker", { job_id: jobId });
    return;
  }

  await incrementAttempts(jobId);

  const tmpDir = `/tmp/export-${jobId}`;

  try {
    await mkdir(tmpDir, { recursive: true });

    // Step 1: Fetch edit decision and related data (5%)
    log("info", "Fetching edit decision and metadata", ctx);
    const editDecision = await getEditDecision(editDecisionId);
    const edl = editDecision.edl_json;
    const aiFills = await getAiFills(editDecisionId);
    const tier = await getUserTier(userId);
    const sourceS3Key = await getSourceVideoS3Key(projectId);
    await updateJobProgress(jobId, 5);

    // Step 2: Download source video and fill segments (20%)
    log("info", "Downloading source video and fill segments", ctx);
    const ext = extname(sourceS3Key) || ".mp4";
    const sourcePath = join(tmpDir, `source${ext}`);
    await downloadFile(sourceS3Key, sourcePath);

    const fillPaths = new Map<string, string>();
    const fillS3Keys = edl
      .filter((e): e is EdlEntry & { s3_key: string } => e.type === "fill" && !!e.s3_key)
      .map((e) => e.s3_key);

    for (let i = 0; i < fillS3Keys.length; i++) {
      const key = fillS3Keys[i];
      const localPath = join(tmpDir, `fill_${i}.mp4`);
      await downloadFile(key, localPath);
      fillPaths.set(key, localPath);
    }
    await updateJobProgress(jobId, 20);

    // Determine output resolution
    const maxHeight = config.resolutionLimits[tier] ?? 1080;
    const sourceProbe = await probeVideo(sourcePath);
    const targetHeight = Math.min(sourceProbe.height, maxHeight);
    const targetFps = 30;

    // Step 3: Extract and re-encode segments (50%)
    log("info", `Extracting ${edl.length} segments (target: ${targetHeight}p)`, ctx);
    const segmentPaths = await extractSegments(
      edl,
      sourcePath,
      fillPaths,
      tmpDir,
      targetHeight,
      targetFps,
    );
    await updateJobProgress(jobId, 50);

    // Step 4: Concatenate segments (60%)
    const rawOutputPath = join(tmpDir, "output_raw.mp4");
    await concatenateSegments(segmentPaths, rawOutputPath, tmpDir);
    await updateJobProgress(jobId, 60);

    // Step 5: Audio normalization (70%)
    const normalizedPath = join(tmpDir, "output_norm.mp4");
    await normalizeAudio(rawOutputPath, normalizedPath);
    await updateJobProgress(jobId, 70);

    // Step 6: Watermark (free tier only) (80%)
    let finalPath: string;
    const shouldWatermark = tier === "free";

    if (shouldWatermark) {
      finalPath = join(tmpDir, "output_final.mp4");
      await applyWatermark(normalizedPath, finalPath);
    } else {
      finalPath = normalizedPath;
    }
    await updateJobProgress(jobId, 80);

    // Step 7: Probe final output and upload to S3 (90%)
    const finalProbe = await probeVideo(finalPath);
    const finalFileSize = (await stat(finalPath)).size;
    const exportId = randomUUID();
    const exportS3Key = `exports/${userId}/${projectId}/${exportId}.mp4`;

    log("info", "Uploading final export to S3", { ...ctx, s3_key: exportS3Key });
    await uploadFile(finalPath, exportS3Key, "video/mp4");
    await updateJobProgress(jobId, 90);

    // Step 8: Generate signed download URL
    const downloadUrl = generateSignedDownloadUrl(exportS3Key, 3600);

    // Step 9: Build fill summary from ai_fills data
    const fillSummary = buildFillSummary(aiFills, editDecision.credits_charged);

    // Step 10: Update database (100%)
    log("info", "Updating database records", ctx);

    const dbExportId = await insertExport({
      projectId,
      editDecisionId,
      s3Key: exportS3Key,
      format: "mp4",
      resolution: `${finalProbe.width}x${finalProbe.height}`,
      duration: finalProbe.duration,
      fileSizeBytes: finalFileSize,
      watermarked: shouldWatermark,
      fillSummary,
      downloadUrl,
    });

    await updateEditDecisionStatus(editDecisionId, "complete");
    await updateProjectStatus(projectId, "complete");
    await completeJob(jobId);

    log("info", "Export job complete", {
      ...ctx,
      export_id: dbExportId,
      duration: finalProbe.duration,
      file_size: finalFileSize,
      watermarked: shouldWatermark,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("error", "Export job failed", { ...ctx, error: message });
    await failJob(jobId, message);
    await updateProjectStatus(projectId, "failed").catch(() => {});
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function buildFillSummary(
  aiFills: { method: string; duration: number | null }[],
  creditsCharged: number,
): FillSummary {
  let aiCount = 0;
  let crossfadeCount = 0;
  let hardCutCount = 0;

  for (const fill of aiFills) {
    switch (fill.method) {
      case "ai_fill":
        aiCount++;
        break;
      case "crossfade":
        crossfadeCount++;
        break;
      case "hard_cut":
        hardCutCount++;
        break;
    }
  }

  return {
    total_gaps: aiFills.length,
    ai_fills: aiCount,
    crossfades: crossfadeCount,
    hard_cuts: hardCutCount,
    credits_used: creditsCharged,
    credits_refunded: 0, // MVP: no partial refunds tracked at export time
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  log("error", "Fatal error starting exporter", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
