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

      segmentPaths.push(segPath);
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

      segmentPaths.push(segPath);
    } else {
      log("warn", `Unknown EDL entry type: ${entry.type}, skipping segment ${i}`);
    }
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
 * Concatenate segments with cross-fade transitions using FFmpeg xfade filter.
 * Requires re-encoding but produces smoother transitions between segments.
 */
export async function concatenateWithCrossfade(
  segmentPaths: string[],
  outputPath: string,
  _tmpDir: string,
  crossfadeDuration: number,
): Promise<void> {
  if (segmentPaths.length === 0) {
    throw new Error("No segments to concatenate");
  }

  if (segmentPaths.length === 1) {
    // Single segment — just copy it
    await execFileAsync("ffmpeg", [
      "-i", segmentPaths[0],
      "-c", "copy",
      "-movflags", "+faststart",
      "-y", outputPath,
    ], { timeout: 30 * 60 * 1000 });
    return;
  }

  // Probe each segment for its duration
  const durations: number[] = [];
  for (const segPath of segmentPaths) {
    const probe = await probeVideo(segPath);
    durations.push(probe.duration);
  }

  log("info", `Cross-fading ${segmentPaths.length} segments (fade: ${crossfadeDuration}s)`);

  // Build FFmpeg xfade filter chain:
  // For N segments, we need N-1 xfade filters chained together.
  // [0][1]xfade=transition=fade:duration=D:offset=O1[v01];
  // [v01][2]xfade=transition=fade:duration=D:offset=O2[v012]; ...
  // Similarly for audio: acrossfade
  const inputs: string[] = [];
  for (const p of segmentPaths) {
    inputs.push("-i", p);
  }

  const filterParts: string[] = [];
  const audioFilterParts: string[] = [];
  let prevVideoLabel = "[0:v]";
  let prevAudioLabel = "[0:a]";
  let cumulativeOffset = durations[0];

  const FADE_EPSILON = 1e-3;

  for (let i = 1; i < segmentPaths.length; i++) {
    // Clamp fade duration so it doesn't exceed either adjacent segment
    const minSegDuration = Math.min(durations[i - 1], durations[i]);
    const fadeDuration = minSegDuration > 2 * FADE_EPSILON
      ? Math.min(crossfadeDuration, minSegDuration - FADE_EPSILON)
      : Math.min(crossfadeDuration, Math.max(0, minSegDuration));

    const offset = Math.max(0, cumulativeOffset - fadeDuration);
    const outVideoLabel = i === segmentPaths.length - 1 ? "[vout]" : `[v${i}]`;
    const outAudioLabel = i === segmentPaths.length - 1 ? "[aout]" : `[a${i}]`;

    filterParts.push(
      `${prevVideoLabel}[${i}:v]xfade=transition=fade:duration=${fadeDuration.toFixed(3)}:offset=${offset.toFixed(3)}${outVideoLabel}`
    );
    audioFilterParts.push(
      `${prevAudioLabel}[${i}:a]acrossfade=d=${fadeDuration.toFixed(3)}:c1=tri:c2=tri${outAudioLabel}`
    );

    prevVideoLabel = outVideoLabel;
    prevAudioLabel = outAudioLabel;
    // Each xfade shortens the output by the actual fade duration used
    cumulativeOffset = offset + durations[i];
  }

  const filterComplex = [...filterParts, ...audioFilterParts].join(";");

  await execFileAsync("ffmpeg", [
    ...inputs,
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    "-map", "[aout]",
    "-c:v", "libx264", "-preset", "fast", "-crf", "18",
    "-c:a", "aac", "-b:a", "128k",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-y", outputPath,
  ], { timeout: 60 * 60 * 1000 });
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
