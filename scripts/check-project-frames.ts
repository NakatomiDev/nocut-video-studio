#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Diagnostic script: checks if boundary frames exist in S3 for a project.
 *
 * Usage:
 *   deno run --allow-net --allow-env scripts/check-project-frames.ts <project-id> [timestamps...]
 *
 * Examples:
 *   # Check if any frames exist for a project
 *   deno run --allow-net --allow-env scripts/check-project-frames.ts abc-123
 *
 *   # Check specific timestamps
 *   deno run --allow-net --allow-env scripts/check-project-frames.ts abc-123 5.000 10.500
 *
 * Environment:
 *   AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (optional — to look up EDL timestamps)
 */

import { S3Client, HeadObjectCommand, ListObjectsV2Command } from "npm:@aws-sdk/client-s3";

const projectId = Deno.args[0];
if (!projectId) {
  console.error("Usage: check-project-frames.ts <project-id> [timestamps...]");
  Deno.exit(1);
}

const region = Deno.env.get("AWS_REGION");
const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID");
const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
const bucket = Deno.env.get("AWS_S3_BUCKET");

if (!region || !accessKeyId || !secretAccessKey || !bucket) {
  console.error("ERROR: AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_S3_BUCKET must be set.");
  Deno.exit(1);
}

const s3 = new S3Client({
  region,
  credentials: { accessKeyId, secretAccessKey },
});

console.log(`=== Frame Diagnostic for Project ${projectId} ===`);
console.log(`Bucket: ${bucket}`);
console.log();

// ---------------------------------------------------------------------------
// 1. List all frames that exist in S3 for this project
// ---------------------------------------------------------------------------

console.log("--- Existing frames in S3 ---");
const prefix = `frames/${projectId}/`;

try {
  const listResult = await s3.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
  }));

  const objects = listResult.Contents ?? [];
  if (objects.length === 0) {
    console.log("  NO FRAMES FOUND in S3 for this project.");
    console.log(`  Expected at: s3://${bucket}/${prefix}frame_*.png`);
    console.log();
    console.log("  This means frame extraction never completed successfully.");
    console.log("  Possible causes:");
    console.log("    - The transcoder service is not running");
    console.log("    - The video.extract_frames job failed or timed out");
    console.log("    - The source video S3 key is missing or incorrect");
  } else {
    console.log(`  Found ${objects.length} frame(s):`);
    for (const obj of objects) {
      const key = obj.Key ?? "";
      const size = obj.Size ?? 0;
      const modified = obj.LastModified?.toISOString() ?? "unknown";
      // Extract timestamp from filename: frame_5_000.png → 5.000
      const match = key.match(/frame_(\d+)_(\d+)\.png$/);
      const ts = match ? `${match[1]}.${match[2]}` : "?";
      console.log(`    ${key} — ${size} bytes, ts=${ts}, modified=${modified}`);
    }
  }
} catch (err) {
  console.error(`  ERROR listing frames: ${(err as Error).message}`);
}

console.log();

// ---------------------------------------------------------------------------
// 2. Check specific timestamps if provided
// ---------------------------------------------------------------------------

const timestamps = Deno.args.slice(1).map(Number).filter((n) => !isNaN(n));

if (timestamps.length > 0) {
  console.log("--- Checking specific timestamps ---");
  for (const ts of timestamps) {
    const frameName = `frame_${ts.toFixed(3).replace(".", "_")}.png`;
    const s3Key = `${prefix}${frameName}`;
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: s3Key }));
      console.log(`  ✓ ${s3Key} — ${head.ContentLength} bytes`);
    } catch (err) {
      const status = (err as any)?.$metadata?.httpStatusCode;
      if (status === 404) {
        console.log(`  ✗ ${s3Key} — NOT FOUND`);
      } else {
        console.log(`  ✗ ${s3Key} — ERROR (${status}): ${(err as Error).message}`);
      }
    }
  }
  console.log();
}

// ---------------------------------------------------------------------------
// 3. Also list AI fill outputs for this project
// ---------------------------------------------------------------------------

console.log("--- AI fill outputs in S3 ---");
const fillPrefix = `ai-fills/${projectId}/`;

try {
  const listResult = await s3.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: fillPrefix,
  }));

  const objects = listResult.Contents ?? [];
  if (objects.length === 0) {
    console.log("  No AI fill outputs found.");
  } else {
    console.log(`  Found ${objects.length} fill(s):`);
    for (const obj of objects) {
      const key = obj.Key ?? "";
      const size = obj.Size ?? 0;
      const modified = obj.LastModified?.toISOString() ?? "unknown";
      console.log(`    ${key} — ${(size / 1024 / 1024).toFixed(2)} MB, modified=${modified}`);
    }
  }
} catch (err) {
  console.error(`  ERROR listing fills: ${(err as Error).message}`);
}

console.log();

// ---------------------------------------------------------------------------
// 4. Optionally look up edit decisions from Supabase
// ---------------------------------------------------------------------------

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (supabaseUrl && supabaseKey) {
  console.log("--- Edit decisions (from Supabase) ---");
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/edit_decisions?project_id=eq.${projectId}&order=created_at.desc&limit=5`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      },
    );
    const decisions = await response.json();
    if (!Array.isArray(decisions) || decisions.length === 0) {
      console.log("  No edit decisions found.");
    } else {
      for (const ed of decisions) {
        console.log(`  Edit decision ${ed.id}:`);
        console.log(`    Status: ${ed.status}, Model: ${ed.model}`);
        console.log(`    Credits charged: ${ed.credits_charged}`);
        const edl = ed.edl_json;
        if (Array.isArray(edl)) {
          for (const gap of edl) {
            console.log(`    Gap: start=${gap.start}, end=${gap.end}, fill_duration=${gap.fill_duration}`);
            console.log(`      Expected frame timestamps: ${gap.start.toFixed(3)}, ${gap.end.toFixed(3)}`);
          }
        }
      }
    }
  } catch (err) {
    console.error(`  ERROR querying Supabase: ${(err as Error).message}`);
  }
  console.log();

  // Also check recent job_queue entries
  console.log("--- Recent jobs (from Supabase) ---");
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/job_queue?project_id=eq.${projectId}&order=created_at.desc&limit=10`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      },
    );
    const jobs = await response.json();
    if (!Array.isArray(jobs) || jobs.length === 0) {
      console.log("  No jobs found.");
    } else {
      for (const job of jobs) {
        console.log(`  Job ${job.id}: type=${job.type}, status=${job.status}, attempts=${job.attempts}/${job.max_attempts}`);
        if (job.error_message) {
          console.log(`    Error: ${job.error_message}`);
        }
      }
    }
  } catch (err) {
    console.error(`  ERROR querying Supabase: ${(err as Error).message}`);
  }
} else {
  console.log("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to also check edit decisions and job history.");
}

console.log("\n=== Done ===");
