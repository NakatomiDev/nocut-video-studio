import { execFile } from "node:child_process";
import { mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { downloadFile, uploadBuffer } from "./s3.js";

const execFileAsync = promisify(execFile);

function log(level: string, msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));
}

export interface FrameExtractionJob {
  jobId: string;
  projectId: string;
  userId: string;
  videoS3Key: string;
  timestamps: number[]; // seconds
}

export interface ExtractedFrame {
  timestamp: number;
  s3Key: string;
}

/**
 * Extracts frames at specific timestamps from a video and uploads them to S3 as PNGs.
 * Returns an array of S3 keys for each extracted frame.
 */
export async function extractFrames(data: FrameExtractionJob): Promise<ExtractedFrame[]> {
  const { jobId, projectId, userId, videoS3Key, timestamps } = data;
  const tmpDir = `/tmp/frames-${jobId}`;
  const s3Prefix = `frames/${projectId}`;

  log("info", "Starting frame extraction", {
    job_id: jobId,
    project_id: projectId,
    timestamps,
  });

  try {
    await mkdir(tmpDir, { recursive: true });

    // Download source video
    const sourcePath = join(tmpDir, "source.mp4");
    await downloadFile(videoS3Key, sourcePath);

    const results: ExtractedFrame[] = [];

    // Extract each frame at the specified timestamp
    for (const ts of timestamps) {
      const frameName = `frame_${ts.toFixed(3).replace(".", "_")}.png`;
      const framePath = join(tmpDir, frameName);

      await execFileAsync("ffmpeg", [
        "-ss", ts.toFixed(3),
        "-i", sourcePath,
        "-frames:v", "1",
        "-q:v", "2",
        "-y", framePath,
      ], { timeout: 30_000 });

      // Read frame and upload to S3
      const frameBuffer = await readFile(framePath);
      const s3Key = `${s3Prefix}/${frameName}`;
      await uploadBuffer(Buffer.from(frameBuffer), s3Key, "image/png");

      results.push({ timestamp: ts, s3Key });

      log("info", "Frame extracted and uploaded", {
        job_id: jobId,
        timestamp: ts,
        s3_key: s3Key,
        size_bytes: frameBuffer.byteLength,
      });
    }

    return results;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
