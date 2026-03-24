/**
 * Converts cut-based EDL (as stored by project-edl) into segment-based EDL
 * that the exporter pipeline understands.
 *
 * This mirrors the logic in supabase/functions/export-video/index.ts
 * buildMediaConvertInputs() (lines 267-346).
 */

import type { EdlEntry, CutBasedEdlEntry } from "./supabase.js";

/**
 * Detect whether the EDL uses the cut-based format (from project-edl)
 * vs the segment-based format (type: "source" | "fill").
 */
export function isCutBasedEdl(
  edl: EdlEntry[] | CutBasedEdlEntry[],
): edl is CutBasedEdlEntry[] {
  if (edl.length === 0) return false;
  const first = edl[0] as unknown as Record<string, unknown>;
  // Cut-based entries have fill_duration and types like "silence", "manual", "gap"
  if (typeof first.fill_duration === "number") return true;
  const t = first.type as string;
  return t !== "source" && t !== "fill";
}

/**
 * Convert cut-based EDL entries into segment-based entries.
 *
 * Cut-based: each entry is a *cut* (removed content) with start/end boundaries.
 * Segment-based: each entry is either a source segment or a fill segment to include.
 *
 * Example:
 *   Video = 60s, cuts = [{start:10, end:20, fill_duration:5, existing_fill_s3_keys:["k"]}]
 *   → [{type:"source", start:0, end:10},
 *      {type:"fill", s3_key:"k", duration:5},
 *      {type:"source", start:20, end:60}]
 */
export function convertCutBasedEdl(
  cuts: CutBasedEdlEntry[],
  aiFillsByGapIndex: Map<number, string>,
  videoDuration: number,
): EdlEntry[] {
  const segments: EdlEntry[] = [];

  // Sort cuts by start time, preserving original index for ai_fills lookup
  const sorted = [...cuts]
    .map((c, i) => ({ ...c, originalIndex: i }))
    .sort((a, b) => a.start - b.start);

  let cursor = 0;

  for (const cut of sorted) {
    // Source segment before this cut (cursor → cut.start)
    if (cut.start > cursor + 0.05) {
      segments.push({
        type: "source",
        start: cursor,
        end: cut.start,
      });
    }

    // Resolve fill S3 keys: prefer existing_fill_s3_keys array,
    // fall back to singular key, then ai_fills table lookup
    const fillKeys: string[] =
      cut.existing_fill_s3_keys && cut.existing_fill_s3_keys.length > 0
        ? cut.existing_fill_s3_keys
        : cut.existing_fill_s3_key
          ? [cut.existing_fill_s3_key]
          : aiFillsByGapIndex.has(cut.originalIndex)
            ? [aiFillsByGapIndex.get(cut.originalIndex)!]
            : [];

    if (cut.fill_duration > 0 && fillKeys.length > 0) {
      for (const key of fillKeys) {
        segments.push({
          type: "fill",
          s3_key: key,
          duration: cut.fill_duration / fillKeys.length,
        });
      }
    }

    cursor = cut.end;
  }

  // Trailing source segment after last cut
  if (videoDuration > cursor + 0.05) {
    segments.push({
      type: "source",
      start: cursor,
      end: videoDuration,
    });
  }

  return segments;
}
