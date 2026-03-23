/**
 * Audio normalization using FFmpeg loudnorm filter.
 *
 * Targets EBU R128 loudness: -16 LUFS integrated, 11 LRA, -1.5 dBTP.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function log(level: string, msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));
}

/**
 * Normalize audio loudness using the EBU R128 loudnorm filter.
 *
 * @param inputPath - Path to the input video.
 * @param outputPath - Path to write the normalized video.
 */
export async function normalizeAudio(inputPath: string, outputPath: string): Promise<void> {
  log("info", "Normalizing audio (EBU R128)");

  await execFileAsync("ffmpeg", [
    "-i", inputPath,
    "-af", "loudnorm=I=-16:LRA=11:TP=-1.5",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    "-y", outputPath,
  ], { timeout: 30 * 60 * 1000 });

  log("info", "Audio normalization complete");
}
