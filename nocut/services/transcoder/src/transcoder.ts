import { execFile, spawn } from "node:child_process";
import { mkdir, rm, readdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { promisify } from "node:util";

import { downloadFile, uploadFile, uploadBuffer } from "./s3.js";
import {
  updateJobProgress,
  completeJob,
  failJob,
  updateVideoResults,
  updateProjectStatus,
  enqueueDetectJob,
  type TranscodeJobRow,
} from "./supabase.js";

const execFileAsync = promisify(execFile);

export interface TranscodeJobData {
  jobId: string;
  projectId: string;
  userId: string;
  videoId: string;
  s3Key: string;
}

interface ProbeResult {
  duration: number;
  width: number;
  height: number;
}

function log(level: string, msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));
}

export function jobRowToData(row: TranscodeJobRow): TranscodeJobData {
  return {
    jobId: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    videoId: row.payload.video_id,
    s3Key: row.payload.s3_key,
  };
}

export async function processTranscodeJob(data: TranscodeJobData): Promise<void> {
  const { jobId, projectId, userId, videoId, s3Key } = data;
  const ctx = { job_id: jobId, project_id: projectId, video_id: videoId };
  const tmpDir = `/tmp/transcode-${jobId}`;
  const ext = extname(s3Key) || ".mp4";
  const s3Prefix = `uploads/${userId}/${projectId}`;

  log("info", "Starting transcode job", ctx);

  try {
    await mkdir(tmpDir, { recursive: true });
    await mkdir(join(tmpDir, "thumbs"), { recursive: true });

    // Step 1: Download source from S3 (5%)
    const sourcePath = join(tmpDir, `source${ext}`);
    log("info", "Downloading source from S3", { ...ctx, s3_key: s3Key });
    await downloadFile(s3Key, sourcePath);
    await updateJobProgress(jobId, 5);

    // Step 2: Probe source for duration and resolution (10%)
    log("info", "Probing source video", ctx);
    const probe = await probeVideo(sourcePath);
    log("info", "Probe complete", { ...ctx, duration: probe.duration, resolution: `${probe.width}x${probe.height}` });
    await updateJobProgress(jobId, 10);

    // Step 3: Transcode to H.264/AAC (50%)
    const transcodedPath = join(tmpDir, "transcoded.mp4");
    log("info", "Transcoding to H.264/AAC", ctx);
    await execFileAsync("ffmpeg", [
      "-i", sourcePath,
      "-c:v", "libx264", "-preset", "medium", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      "-y", transcodedPath,
    ], { timeout: 30 * 60 * 1000 }); // 30 min timeout
    await updateJobProgress(jobId, 50);

    // Step 4: Generate 360p proxy (65%)
    const proxyPath = join(tmpDir, "proxy.mp4");
    log("info", "Generating 360p proxy", ctx);
    await execFileAsync("ffmpeg", [
      "-i", sourcePath,
      "-vf", "scale=-2:360",
      "-c:v", "libx264", "-preset", "fast", "-crf", "28",
      "-c:a", "aac", "-b:a", "64k",
      "-movflags", "+faststart",
      "-y", proxyPath,
    ], { timeout: 15 * 60 * 1000 });
    await updateJobProgress(jobId, 65);

    // Step 5: Extract audio waveform (75%)
    log("info", "Extracting waveform data", ctx);
    const waveformData = await extractWaveform(sourcePath, probe.duration);
    const waveformBuffer = Buffer.from(JSON.stringify(waveformData));
    await updateJobProgress(jobId, 75);

    // Step 6: Generate thumbnail sprite sheets (85%)
    log("info", "Generating thumbnail sprites", ctx);
    await generateThumbnailSprites(sourcePath, tmpDir);
    await updateJobProgress(jobId, 85);

    // Step 7: Upload all outputs to S3 (90%)
    log("info", "Uploading results to S3", ctx);
    const transcodedKey = `${s3Prefix}/transcoded.mp4`;
    const proxyKey = `${s3Prefix}/proxy.mp4`;
    const waveformKey = `${s3Prefix}/waveform.json`;

    await Promise.all([
      uploadFile(transcodedPath, transcodedKey, "video/mp4"),
      uploadFile(proxyPath, proxyKey, "video/mp4"),
      uploadBuffer(waveformBuffer, waveformKey, "application/json"),
    ]);

    // Upload sprite sheets
    const spriteKeys = await uploadSpriteSheets(tmpDir, s3Prefix);
    const firstSpriteKey = spriteKeys.length > 0 ? spriteKeys[0] : `${s3Prefix}/thumbnails/sprite_001.jpg`;

    await updateJobProgress(jobId, 90);

    // Step 8: Update database (100%)
    log("info", "Updating database records", ctx);
    await updateVideoResults(videoId, {
      proxy_s3_key: proxyKey,
      waveform_s3_key: waveformKey,
      thumbnail_sprite_s3_key: firstSpriteKey,
      duration: probe.duration,
      resolution: `${probe.width}x${probe.height}`,
    });

    await updateProjectStatus(projectId, "detecting");
    await enqueueDetectJob(projectId, userId, videoId, transcodedKey);
    await completeJob(jobId);

    log("info", "Transcode job complete", ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("error", "Transcode job failed", { ...ctx, error: message });
    await failJob(jobId, message);
    await updateProjectStatus(projectId, "failed").catch(() => {});
    throw err;
  } finally {
    // Cleanup temp directory
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function probeVideo(filePath: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);

  const info = JSON.parse(stdout);
  const videoStream = info.streams?.find((s: { codec_type: string }) => s.codec_type === "video");

  const duration = parseFloat(info.format?.duration || "0");
  const width = videoStream?.width || 0;
  const height = videoStream?.height || 0;

  if (duration <= 0) {
    throw new Error("Could not determine video duration");
  }

  return { duration, width, height };
}

async function extractWaveform(filePath: string, duration: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i", filePath,
      "-ac", "1",
      "-ar", "8000",
      "-f", "f32le",
      "-v", "quiet",
      "pipe:1",
    ]);

    const chunks: Buffer[] = [];

    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    ffmpeg.stderr.on("data", () => {
      // Ignore stderr from ffmpeg
    });

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg waveform extraction exited with code ${code}`));
        return;
      }

      const raw = Buffer.concat(chunks);
      const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);

      // Downsample to ~1000 points
      const targetPoints = Math.min(1000, samples.length);
      if (targetPoints === 0) {
        resolve([]);
        return;
      }

      const bucketSize = Math.max(1, Math.floor(samples.length / targetPoints));
      const waveform: number[] = [];

      for (let i = 0; i < targetPoints; i++) {
        const start = i * bucketSize;
        const end = Math.min(start + bucketSize, samples.length);
        let sum = 0;
        for (let j = start; j < end; j++) {
          sum += Math.abs(samples[j]);
        }
        waveform.push(sum / (end - start));
      }

      // Normalize to 0-1
      const max = Math.max(...waveform, 0.0001);
      const normalized = waveform.map((v) => Math.round((v / max) * 1000) / 1000);

      resolve(normalized);
    });

    ffmpeg.on("error", reject);
  });
}

async function generateThumbnailSprites(sourcePath: string, tmpDir: string): Promise<void> {
  const thumbsDir = join(tmpDir, "thumbs");

  // Generate sprite sheets: 1 frame per second, tiled 10x1, outputs multiple files for longer videos
  await execFileAsync("ffmpeg", [
    "-i", sourcePath,
    "-vf", "fps=1,scale=160:-1,tile=10x1",
    "-q:v", "5",
    "-y", join(thumbsDir, "sprite_%03d.jpg"),
  ], { timeout: 10 * 60 * 1000 });
}

async function uploadSpriteSheets(tmpDir: string, s3Prefix: string): Promise<string[]> {
  const thumbsDir = join(tmpDir, "thumbs");
  const files = await readdir(thumbsDir);
  const spriteFiles = files
    .filter((f) => f.startsWith("sprite_") && f.endsWith(".jpg"))
    .sort();

  const keys: string[] = [];
  for (const file of spriteFiles) {
    const s3Key = `${s3Prefix}/thumbnails/${file}`;
    await uploadFile(join(thumbsDir, file), s3Key, "image/jpeg");
    keys.push(s3Key);
  }

  return keys;
}
