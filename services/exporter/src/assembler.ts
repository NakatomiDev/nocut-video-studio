/**
 * Video assembly: builds the final export from source segments and AI fill clips.
 *
 * Pipeline:
 * 1. Extract source segments with -ss/-to
 * 2. Write FFmpeg concat list
 * 3. Concatenate with re-encoding for codec consistency
 */

import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { EdlEntry } from "./supabase.js";

const execFileAsync = promisify(execFile);

function log(level: string, msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));
}

/**
 * Extract source segments and build the concat list.
 *
 * For each EDL entry:
 * - "source" segments are extracted from the source video with -ss/-to
 * - "fill" segments reference the downloaded fill file directly
 *
 * All segments are re-encoded to ensure consistent codec/timebase for concat.
 */
export async function extractSegments(
  edl: EdlEntry[],
  sourcePath: string,
  fillPaths: Map<string, string>,
  tmpDir: string,
  resolution: number,
  fps: number,
): Promise<string[]> {
  const segmentPaths: string[] = [];

  for (let i = 0; i < edl.length; i++) {
    const entry = edl[i];
    const segPath = join(tmpDir, `seg_${String(i).padStart(4, "0")}.mp4`);

    if (entry.type === "source") {
      const start = entry.start ?? 0;
      const end = entry.end ?? 0;

      log("info", `Extracting source segment ${i}`, { start, end });

      await execFileAsync("ffmpeg", [
        "-ss", String(start),
        "-to", String(end),
        "-i", sourcePath,
        "-vf", `scale=-2:${resolution}`,
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-c:a", "aac", "-b:a", "128k",
        "-r", String(fps),
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-y", segPath,
      ], { timeout: 15 * 60 * 1000 });
    } else if (entry.type === "fill") {
      const fillKey = entry.s3_key;
      if (!fillKey) {
        throw new Error(`Fill segment ${i} missing s3_key`);
      }
      const fillPath = fillPaths.get(fillKey);
      if (!fillPath) {
        throw new Error(`Fill segment ${i} not downloaded: ${fillKey}`);
      }

      log("info", `Re-encoding fill segment ${i}`, { s3_key: fillKey });

      // Re-encode fill to match source codec/resolution/fps
      await execFileAsync("ffmpeg", [
        "-i", fillPath,
        "-vf", `scale=-2:${resolution}`,
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        // Fill segments may not have audio; generate silent audio track
        "-f", "lavfi", "-t", String(entry.duration ?? 1),
        "-i", "anullsrc=r=48000:cl=stereo",
        "-c:a", "aac", "-b:a", "128k",
        "-r", String(fps),
        "-pix_fmt", "yuv420p",
        "-shortest",
        "-movflags", "+faststart",
        "-y", segPath,
      ], { timeout: 5 * 60 * 1000 });
    }

    segmentPaths.push(segPath);
  }

  return segmentPaths;
}

/**
 * Concatenate all segments into a single video using FFmpeg concat demuxer.
 */
export async function concatenateSegments(
  segmentPaths: string[],
  outputPath: string,
  tmpDir: string,
): Promise<void> {
  // Write concat list file
  const concatListPath = join(tmpDir, "concat.txt");
  const concatContent = segmentPaths
    .map((p) => `file '${p}'`)
    .join("\n");
  await writeFile(concatListPath, concatContent, "utf-8");

  log("info", `Concatenating ${segmentPaths.length} segments`);

  // Use concat demuxer with copy (segments are already re-encoded to matching codecs)
  await execFileAsync("ffmpeg", [
    "-f", "concat",
    "-safe", "0",
    "-i", concatListPath,
    "-c", "copy",
    "-movflags", "+faststart",
    "-y", outputPath,
  ], { timeout: 30 * 60 * 1000 });
}

/**
 * Probe video for duration and resolution.
 */
export async function probeVideo(filePath: string): Promise<{
  duration: number;
  width: number;
  height: number;
  fileSize: number;
}> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);

  const info = JSON.parse(stdout);
  const videoStream = info.streams?.find((s: { codec_type: string }) => s.codec_type === "video");

  return {
    duration: parseFloat(info.format?.duration || "0"),
    width: videoStream?.width || 0,
    height: videoStream?.height || 0,
    fileSize: parseInt(info.format?.size || "0", 10),
  };
}

/**
 * Parse resolution string (e.g. "1080p") to pixel height.
 */
export function parseResolution(res: string): number {
  const match = res.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 1080;
}
