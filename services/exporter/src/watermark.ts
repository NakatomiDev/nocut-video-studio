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
/**
 * Apply a watermark overlay to the video.
 *
 * @param inputPath - Path to the input video.
 * @param outputPath - Path to write the watermarked video.
 * @param watermarkPath - Path to the watermark PNG image. Defaults to bundled asset.
 */
export async function applyWatermark(
  inputPath: string,
  outputPath: string,
  watermarkPath = "/app/assets/watermark.png",
): Promise<void> {
  log("info", "Applying watermark", { watermarkPath });

  // Scale watermark to 80px height, preserve aspect ratio, place bottom-right with padding
  await execFileAsync("ffmpeg", [
    "-i", inputPath,
    "-i", watermarkPath,
    "-filter_complex",
    "[1:v]scale=-1:80,format=rgba,colorchannelmixer=aa=0.4[wm];[0:v][wm]overlay=W-w-20:H-h-20",
    "-c:v", "libx264", "-preset", "fast", "-crf", "18",
    "-c:a", "copy",
    "-movflags", "+faststart",
    "-y", outputPath,
  ], { timeout: 30 * 60 * 1000 });

  log("info", "Watermark applied");
}
