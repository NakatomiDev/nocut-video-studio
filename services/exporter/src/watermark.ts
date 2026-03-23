/**
 * Watermark overlay for free-tier exports.
 *
 * Adds a small "Made with NoCut" text in the bottom-right corner.
 * Skipped for Pro/Business tier users.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function log(level: string, msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));
}

/**
 * Apply a watermark overlay to the video.
 *
 * @param inputPath - Path to the input video.
 * @param outputPath - Path to write the watermarked video.
 */
export async function applyWatermark(inputPath: string, outputPath: string): Promise<void> {
  log("info", "Applying watermark");

  await execFileAsync("ffmpeg", [
    "-i", inputPath,
    "-vf", "drawtext=text='Made with NoCut':fontsize=24:fontcolor=white@0.5:x=w-tw-20:y=h-th-20",
    "-c:v", "libx264", "-preset", "fast", "-crf", "18",
    "-c:a", "copy",
    "-movflags", "+faststart",
    "-y", outputPath,
  ], { timeout: 30 * 60 * 1000 });

  log("info", "Watermark applied");
}
