import {
  MediaConvertClient,
  CreateJobCommand,
  GetJobCommand,
  type CreateJobCommandInput,
  type Input as McInput,
} from "npm:@aws-sdk/client-mediaconvert";
import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
} from "npm:@aws-sdk/client-s3";
import { getSignedUrl } from "npm:@aws-sdk/cloudfront-signer";
import { handleCors } from "../_shared/cors.ts";
import {
  getAuthenticatedUser,
  createServiceClient,
  AuthError,
} from "../_shared/auth.ts";
import { successResponse, errorResponse } from "../_shared/response.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** EDL entry as stored by project-edl: describes a cut in the original video. */
interface EdlCutEntry {
  start: number;        // where removed content begins (seconds in original)
  end: number;          // where removed content ends (seconds in original)
  type: string;         // "manual", "silence", etc.
  fill_duration: number; // seconds of AI fill to bridge the gap
  model?: string;
  existing_fill_s3_key?: string;  // single pre-generated fill (legacy)
  existing_fill_s3_keys?: string[]; // multiple chained fills per gap
}

interface AiFillRow {
  id: string;
  edit_decision_id: string;
  gap_index: number;
  s3_key: string | null;
  method: string;
  quality_score: number | null;
  duration: number | null;
}

interface FillSummary {
  total_gaps: number;
  ai_fills: number;
  crossfades: number;
  hard_cuts: number;
  credits_used: number;
  credits_refunded: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RESOLUTION_LIMITS: Record<string, number> = {
  free: 720,
  pro: 1080,
  business: 2160,
};

const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_MS = 300_000; // 5 minutes

// ---------------------------------------------------------------------------
// AWS clients (lazy-initialized)
// ---------------------------------------------------------------------------

let _mcClient: MediaConvertClient | null = null;
function getMediaConvertClient(): MediaConvertClient {
  if (!_mcClient) {
    const endpoint = Deno.env.get("AWS_MEDIACONVERT_ENDPOINT");
    if (!endpoint) throw new Error("AWS_MEDIACONVERT_ENDPOINT is not set");

    _mcClient = new MediaConvertClient({
      region: Deno.env.get("AWS_REGION")!,
      endpoint,
      credentials: {
        accessKeyId: Deno.env.get("AWS_ACCESS_KEY_ID")!,
        secretAccessKey: Deno.env.get("AWS_SECRET_ACCESS_KEY")!,
      },
    });
  }
  return _mcClient;
}

let _s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (!_s3Client) {
    _s3Client = new S3Client({
      region: Deno.env.get("AWS_REGION")!,
      credentials: {
        accessKeyId: Deno.env.get("AWS_ACCESS_KEY_ID")!,
        secretAccessKey: Deno.env.get("AWS_SECRET_ACCESS_KEY")!,
      },
    });
  }
  return _s3Client;
}

// ---------------------------------------------------------------------------
// Embedded watermark — "nocut.ai" text on transparent background (300×60 PNG)
// ---------------------------------------------------------------------------

const WATERMARK_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAASwAAAA8CAYAAADc3IdaAAADM0lEQVR4nO3YT0hlVRzA8e95vua9SmeMEkYTyUU0TEOUIVgtYoZw0cYWhmGLCNw5EUhCEbRwaQwUbmphRNDCjbRpU8EDCwIniIYiKiiK1OZP4bUek6T+Wtz74M1jhNHFFPr9bO7vnHvOuedufvzOAUmSJEmSJEmSJEmSJEmSJEmSJEmSpJskIp6+gTF9EfHkzdiPJO0qIhb+6z1I+v9KexlcJJQPgZNAO/B+SunziLgDeBG4FbgKvAlsAy8AHcA/wLmU0npELKSUxprXTCmNRcSzwBjwVUrpbeDXiOgDzhbf+iil9EHTnOeBY8Da/n9f0oEVEYsR8VQRH4+Id4v4pYg4U8RnivZURDxe9D0REZNFvNCy5sJ14qGiPRkR90dER0S8d705kg6P0h7HJ+BjYCilVNnY2OgAHlpdXX0Q+BQ4Uq1Wf19dXR1YWVl5uFKpnAduKZfLa52dncvAqSzLGlXdUMseGu0+oA04BbwD9M7Ozj5Tr9fbgQHg7qb9DCHp0NhrwtpKKdWLeVtHjx7dAr5NKZWL9/3A5Z6enq22tjZSSv1A//b29qUsy84Dl0ulUltjsYi4HSi3fOMX8uPk18ArAHNzc1/u7OzsABe4NmFJOkT2mrB2muKLxfPvWq32M/AYcGx0dPQEcGF5efm7kZGRQaBzYmJiICKeAy5lWfZXcTcFcBqIIk5AKSJSe3v7kaLvXuCzarX6W6VSKQO95NWXpEOotbq5UQFsNRrT09OfjI+Pn15aWuqq1+tXgDempqaq8/Pzr05OTg5mWXYROAdEb2/vW8DLtVotgC/IL+TL5AnrG+C1xcXFO4eHh5fIL/hfn5mZ+WN9ff1qpVK5srm52b3/35V0GLXeHTXa9wFdRdxVtE8CdxV9x4F7ingQuK2Iu4FHm9Z7pHg2qqkh8qRWJa/kdtuHpANsvxXWbn4iP8Z1k99D/UB+7Gzu+74Y+yNwgrzC+pNrj5sb5ImuRH6XtQY8ANTJK7tSy3hJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJOiD+BZwyENWFRwCGAAAAAElFTkSuQmCC";

const WATERMARK_S3_KEY = "assets/watermark.png";

/**
 * Ensure the embedded watermark PNG exists in S3.
 * Uploads it once; subsequent calls are no-ops (checks via HeadObject).
 */
async function ensureWatermarkInS3(bucket: string): Promise<string> {
  const s3 = getS3Client();
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: WATERMARK_S3_KEY }));
    console.log("Watermark already exists in S3");
  } catch {
    console.log("Uploading embedded watermark to S3");
    const raw = Uint8Array.from(atob(WATERMARK_PNG_B64), (c) => c.charCodeAt(0));
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: WATERMARK_S3_KEY,
        Body: raw,
        ContentType: "image/png",
        CacheControl: "public, max-age=31536000",
      }),
    );
    console.log("Watermark uploaded to S3");
  }
  return `s3://${bucket}/${WATERMARK_S3_KEY}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert seconds to SMPTE timecode at 30fps: HH:MM:SS:FF */
function secondsToTimecode(totalSeconds: number): string {
  const fps = 30;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.floor(totalSeconds % 60);
  const frames = Math.round((totalSeconds % 1) * fps);
  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(secs).padStart(2, "0"),
    String(Math.min(frames, fps - 1)).padStart(2, "0"),
  ].join(":");
}

function buildFillSummary(
  aiFills: AiFillRow[],
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
    credits_refunded: 0,
  };
}

function generateSignedDownloadUrl(s3Key: string, expiresInSeconds = 3600): string {
  const cloudfrontDomain = Deno.env.get("AWS_CLOUDFRONT_DOMAIN") || "";
  const cloudfrontKeypairId = Deno.env.get("AWS_CLOUDFRONT_KEYPAIR_ID") || "";
  const cloudfrontPrivateKey = Deno.env.get("AWS_CLOUDFRONT_PRIVATE_KEY") || "";
  const bucket = Deno.env.get("AWS_S3_BUCKET") || "";
  const region = Deno.env.get("AWS_REGION") || "us-east-1";

  if (!cloudfrontDomain || !cloudfrontKeypairId || !cloudfrontPrivateKey) {
    return `https://${bucket}.s3.${region}.amazonaws.com/${s3Key}`;
  }

  const url = `https://${cloudfrontDomain}/${s3Key}`;
  const dateLessThan = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

  return getSignedUrl({
    url,
    keyPairId: cloudfrontKeypairId,
    privateKey: cloudfrontPrivateKey,
    dateLessThan,
  });
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function claimJob(
  serviceClient: ReturnType<typeof createServiceClient>,
  jobId: string,
): Promise<boolean> {
  const { data, error } = await serviceClient
    .from("job_queue")
    .update({
      status: "processing",
      started_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "queued")
    .select("id");

  if (error) {
    console.error("Failed to claim job:", error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

async function updateJobProgress(
  serviceClient: ReturnType<typeof createServiceClient>,
  jobId: string,
  percent: number,
): Promise<void> {
  await serviceClient
    .from("job_queue")
    .update({ progress_percent: Math.min(100, Math.max(0, Math.round(percent))) })
    .eq("id", jobId);
}

async function completeJob(
  serviceClient: ReturnType<typeof createServiceClient>,
  jobId: string,
): Promise<void> {
  await serviceClient
    .from("job_queue")
    .update({
      status: "complete",
      progress_percent: 100,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

async function failJob(
  serviceClient: ReturnType<typeof createServiceClient>,
  jobId: string,
  editDecisionId: string,
  projectId: string,
  message: string,
): Promise<void> {
  await serviceClient
    .from("job_queue")
    .update({
      status: "failed",
      error_message: message.slice(0, 2000),
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  await serviceClient
    .from("edit_decisions")
    .update({ status: "failed" })
    .eq("id", editDecisionId);

  await serviceClient
    .from("projects")
    .update({ status: "failed", error_message: message.slice(0, 500) })
    .eq("id", projectId);
}

// ---------------------------------------------------------------------------
// MediaConvert job builder
// ---------------------------------------------------------------------------

/**
 * Reconstruct the video timeline from the cut-based EDL and AI fills.
 *
 * The EDL describes *cuts* (content to remove). Between/around those cuts
 * are source segments to keep. Each cut with fill_duration > 0 gets an
 * AI-generated fill clip inserted.
 *
 * Example:
 *   Video = 60s, EDL = [{start:10, end:20, fill_duration:5}]
 *   → Source 0–10 | Fill 5s | Source 20–60
 */
function buildMediaConvertInputs(
  cuts: EdlCutEntry[],
  aiFillsByGapIndex: Map<number, string>,  // gap_index → s3_key
  sourceVideoS3Uri: string,
  bucket: string,
  videoDuration: number,
): McInput[] {
  const inputs: McInput[] = [];

  // Sort cuts by start time
  const sorted = [...cuts]
    .map((c, i) => ({ ...c, originalIndex: i }))
    .sort((a, b) => a.start - b.start);

  let cursor = 0; // current position in the original video (seconds)

  for (const cut of sorted) {
    // Source segment before this cut (cursor → cut.start)
    if (cut.start > cursor + 0.05) {
      inputs.push({
        FileInput: sourceVideoS3Uri,
        InputClippings: [
          {
            StartTimecode: secondsToTimecode(cursor),
            EndTimecode: secondsToTimecode(cut.start),
          },
        ],
        VideoSelector: {},
        AudioSelectors: {
          "Audio Selector 1": { DefaultSelection: "DEFAULT" },
        },
        TimecodeSource: "ZEROBASED",
      });
    }

    // AI fills for this gap: prefer existing_fill_s3_keys array, fall back to single key, then ai_fills table
    const fillKeys: string[] = cut.existing_fill_s3_keys && cut.existing_fill_s3_keys.length > 0
      ? cut.existing_fill_s3_keys
      : cut.existing_fill_s3_key
        ? [cut.existing_fill_s3_key]
        : aiFillsByGapIndex.has(cut.originalIndex)
          ? [aiFillsByGapIndex.get(cut.originalIndex)!]
          : [];

    if (cut.fill_duration > 0 && fillKeys.length > 0) {
      for (const key of fillKeys) {
        inputs.push({
          FileInput: `s3://${bucket}/${key}`,
          VideoSelector: {},
          AudioSelectors: {
            "Audio Selector 1": { DefaultSelection: "DEFAULT" },
          },
          TimecodeSource: "ZEROBASED",
        });
      }
    }

    cursor = cut.end;
  }

  // Trailing source segment after last cut (cursor → video end)
  if (videoDuration > cursor + 0.05) {
    inputs.push({
      FileInput: sourceVideoS3Uri,
      InputClippings: [
        {
          StartTimecode: secondsToTimecode(cursor),
          EndTimecode: secondsToTimecode(videoDuration),
        },
      ],
      VideoSelector: {},
      AudioSelectors: {
        "Audio Selector 1": { DefaultSelection: "DEFAULT" },
      },
      TimecodeSource: "ZEROBASED",
    });
  }

  return inputs;
}

function buildMediaConvertJob(params: {
  inputs: McInput[];
  destinationS3Uri: string;
  roleArn: string;
  targetHeight: number;
  watermark: boolean;
  watermarkS3Uri?: string;
}): CreateJobCommandInput {
  const { inputs, destinationS3Uri, roleArn, targetHeight, watermark, watermarkS3Uri } = params;

  // Calculate width to maintain 16:9 aspect ratio, must be even
  const targetWidth = Math.round((targetHeight * 16) / 9 / 2) * 2;

  const videoDescription: Record<string, unknown> = {
    CodecSettings: {
      Codec: "H_264",
      H264Settings: {
        RateControlMode: "QVBR",
        QvbrSettings: { QvbrQualityLevel: 8 },
        CodecProfile: "HIGH",
        CodecLevel: "AUTO",
        FramerateControl: "SPECIFIED",
        FramerateNumerator: 30,
        FramerateDenominator: 1,
        MaxBitrate: 8_000_000,
        GopSize: 2,
        GopSizeUnits: "SECONDS",
      },
    },
    Height: targetHeight,
    Width: targetWidth,
    ScalingBehavior: "DEFAULT",
    AntiAlias: "ENABLED",
  };

  // Add watermark for free tier (embedded 300×60 "nocut.ai" PNG)
  if (watermark && watermarkS3Uri) {
    const wmWidth = 300;
    const wmHeight = 60;
    videoDescription.VideoPreprocessors = {
      ImageInserter: {
        InsertableImages: [
          {
            ImageInserterInput: watermarkS3Uri,
            Layer: 1,
            ImageX: targetWidth - wmWidth - 20,
            ImageY: targetHeight - wmHeight - 20,
            Opacity: 40,
          },
        ],
      },
    };
  }

  return {
    Role: roleArn,
    Settings: {
      Inputs: inputs,
      OutputGroups: [
        {
          OutputGroupSettings: {
            Type: "FILE_GROUP_SETTINGS",
            FileGroupSettings: {
              Destination: destinationS3Uri,
            },
          },
          Outputs: [
            {
              VideoDescription: videoDescription,
              AudioDescriptions: [
                {
                  CodecSettings: {
                    Codec: "AAC",
                    AacSettings: {
                      Bitrate: 128000,
                      CodingMode: "CODING_MODE_2_0",
                      SampleRate: 48000,
                    },
                  },
                  AudioNormalizationSettings: {
                    Algorithm: "ITU_BS_1770_4",
                    LoudnessLogging: "DONT_LOG",
                    TargetLkfs: -16,
                  },
                  AudioSourceName: "Audio Selector 1",
                },
              ],
              ContainerSettings: {
                Container: "MP4",
                Mp4Settings: {
                  MoovPlacement: "PROGRESSIVE_DOWNLOAD",
                  FreeSpaceBox: "EXCLUDE",
                },
              },
              NameModifier: "_export",
            },
          ],
        },
      ],
      TimecodeConfig: {
        Source: "ZEROBASED",
      },
    },
  } as CreateJobCommandInput;
}

// ---------------------------------------------------------------------------
// Background export processor
// ---------------------------------------------------------------------------

async function processExport(
  jobId: string,
  bucket: string,
  roleArn: string,
): Promise<void> {
  const serviceClient = createServiceClient();

  // 1. Load the job
  const { data: job, error: jobError } = await serviceClient
    .from("job_queue")
    .select("*")
    .eq("id", jobId)
    .single();

  if (jobError || !job) {
    console.error(`Export job ${jobId} not found`);
    return;
  }

  if (job.status !== "processing") {
    console.warn(`Export job ${jobId} is ${job.status}, expected processing`);
    return;
  }

  const projectId = job.project_id;
  const userId = job.user_id;
  const payload = job.payload as { edit_decision_id: string; crossfade_duration?: number };
  const editDecisionId = payload.edit_decision_id;
  const crossfadeDuration = payload.crossfade_duration ?? 0;

  if (crossfadeDuration > 0) {
    console.error(
      `Export job ${jobId} requires crossfade_duration=${crossfadeDuration}, which is not supported by the MediaConvert exporter.`,
    );
    throw new Error(
      "Crossfade exports must be handled by the FFmpeg exporter service, not the MediaConvert path.",
    );
  }

  try {
    // 2. Fetch metadata
    await updateJobProgress(serviceClient, jobId, 5);

    const { data: editDecision, error: edError } = await serviceClient
      .from("edit_decisions")
      .select("*")
      .eq("id", editDecisionId)
      .single();

    if (edError || !editDecision) {
      throw new Error(`Edit decision not found: ${editDecisionId}`);
    }

    const edl = editDecision.edl_json as EdlCutEntry[];
    const creditsCharged = editDecision.credits_charged as number;

    const { data: aiFills } = await serviceClient
      .from("ai_fills")
      .select("id, edit_decision_id, gap_index, s3_key, method, quality_score, duration")
      .eq("edit_decision_id", editDecisionId)
      .order("gap_index", { ascending: true });

    // Build a lookup: gap_index → s3_key for AI fill clips
    const aiFillsByGapIndex = new Map<number, string>();
    for (const fill of (aiFills ?? [])) {
      if (fill.s3_key) {
        aiFillsByGapIndex.set(fill.gap_index, fill.s3_key);
      }
    }

    const { data: userRecord } = await serviceClient
      .from("users")
      .select("tier")
      .eq("id", userId)
      .single();
    const tier = userRecord?.tier || "free";

    const { data: projectVideo } = await serviceClient
      .from("videos")
      .select("s3_key, duration")
      .eq("project_id", projectId)
      .single();

    if (!projectVideo?.s3_key) {
      throw new Error(`Source video not found for project ${projectId}`);
    }
    const sourceS3Key = projectVideo.s3_key;
    const videoDuration = projectVideo.duration as number;

    if (!videoDuration || videoDuration <= 0) {
      throw new Error(`Source video has no duration metadata for project ${projectId}`);
    }

    await updateJobProgress(serviceClient, jobId, 10);

    // 3. Build and submit MediaConvert job
    const maxHeight = RESOLUTION_LIMITS[tier] ?? 1080;
    const targetHeight = maxHeight;
    const shouldWatermark = tier === "free";
    let watermarkS3Uri: string | undefined;
    if (shouldWatermark) {
      watermarkS3Uri = await ensureWatermarkInS3(bucket);
    }

    const sourceVideoS3Uri = `s3://${bucket}/${sourceS3Key}`;
    const exportId = crypto.randomUUID();
    const exportS3KeyBase = `exports/${userId}/${projectId}/${exportId}`;
    const destinationS3Uri = `s3://${bucket}/${exportS3KeyBase}`;

    const inputs = buildMediaConvertInputs(edl, aiFillsByGapIndex, sourceVideoS3Uri, bucket, videoDuration);

    if (inputs.length === 0) {
      throw new Error("No valid segments found in EDL");
    }

    const jobParams = buildMediaConvertJob({
      inputs,
      destinationS3Uri,
      roleArn,
      targetHeight,
      watermark: shouldWatermark,
      watermarkS3Uri,
    });

    console.log(`Submitting MediaConvert job with ${inputs.length} inputs`);
    const mcClient = getMediaConvertClient();
    const createResult = await mcClient.send(new CreateJobCommand(jobParams));
    const mcJobId = createResult.Job?.Id;

    if (!mcJobId) {
      throw new Error("MediaConvert did not return a job ID");
    }

    console.log(`MediaConvert job created: ${mcJobId}`);
    await updateJobProgress(serviceClient, jobId, 20);

    // 4. Poll for MediaConvert completion
    const startTime = Date.now();
    let mcStatus = "SUBMITTED";
    let lastProgress = 20;

    while (Date.now() - startTime < MAX_POLL_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const getResult = await mcClient.send(
        new GetJobCommand({ Id: mcJobId }),
      );
      const mcJob = getResult.Job;

      if (!mcJob) {
        throw new Error("MediaConvert job disappeared");
      }

      mcStatus = mcJob.Status || "UNKNOWN";
      const mcPercent = mcJob.JobPercentComplete ?? 0;

      // Map MediaConvert 0-100% to our 20-95% range
      const mappedProgress = 20 + Math.round(mcPercent * 0.75);
      if (mappedProgress > lastProgress) {
        lastProgress = mappedProgress;
        await updateJobProgress(serviceClient, jobId, mappedProgress);
      }

      console.log(`MediaConvert job ${mcJobId}: ${mcStatus} (${mcPercent}%)`);

      if (mcStatus === "COMPLETE") {
        break;
      }
      if (mcStatus === "ERROR" || mcStatus === "CANCELED") {
        const errorMsg = mcJob.ErrorMessage || `MediaConvert job ${mcStatus}`;
        throw new Error(errorMsg);
      }
    }

    if (mcStatus !== "COMPLETE") {
      throw new Error(
        `MediaConvert job timed out after ${MAX_POLL_MS / 1000}s (status: ${mcStatus}). ` +
        `Job ${mcJobId} may still complete — check AWS console.`,
      );
    }

    // 5. Get output file info
    // MediaConvert appends a name modifier + .mp4 to the destination
    const exportS3Key = `${exportS3KeyBase}_export.mp4`;

    let fileSizeBytes = 0;
    try {
      const headResult = await getS3Client().send(
        new HeadObjectCommand({ Bucket: bucket, Key: exportS3Key }),
      );
      fileSizeBytes = headResult.ContentLength ?? 0;
    } catch {
      console.warn("Could not determine output file size via HeadObject");
    }

    await updateJobProgress(serviceClient, jobId, 95);

    // 6. Generate download URL
    const downloadUrl = generateSignedDownloadUrl(exportS3Key, 3600);

    // 7. Build fill summary
    const fillSummary = buildFillSummary(
      (aiFills as AiFillRow[]) || [],
      creditsCharged,
    );

    // 8. Insert export record
    const { data: exportRecord, error: exportError } = await serviceClient
      .from("exports")
      .insert({
        project_id: projectId,
        edit_decision_id: editDecisionId,
        s3_key: exportS3Key,
        format: "mp4",
        resolution: `${Math.round((targetHeight * 16) / 9 / 2) * 2}x${targetHeight}`,
        duration: 0,
        file_size_bytes: fileSizeBytes,
        watermarked: shouldWatermark,
        fill_summary_json: fillSummary,
        download_url: downloadUrl,
      })
      .select("id")
      .single();

    if (exportError) {
      throw new Error(`Failed to insert export record: ${exportError.message}`);
    }

    // 9. Update statuses
    await serviceClient
      .from("edit_decisions")
      .update({ status: "complete" })
      .eq("id", editDecisionId);

    await serviceClient
      .from("projects")
      .update({ status: "complete" })
      .eq("id", projectId);

    await completeJob(serviceClient, jobId);

    console.log(`Export complete: ${exportRecord?.id}, s3: ${exportS3Key}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Export job ${jobId} failed:`, message);
    await failJob(serviceClient, jobId, editDecisionId, projectId, message);
  }
}

// ---------------------------------------------------------------------------
// Main handler — returns 202 immediately, processes in background
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: { waitUntil(promise: Promise<any>): void };

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "Only POST is allowed", 405);
  }

  // Environment validation
  const requiredEnvVars = [
    "AWS_MEDIACONVERT_ENDPOINT",
    "AWS_MEDIACONVERT_ROLE_ARN",
    "AWS_REGION",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_S3_BUCKET",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  for (const envVar of requiredEnvVars) {
    if (!Deno.env.get(envVar)) {
      console.error(`Missing required env var: ${envVar}`);
      return errorResponse("config_error", `Server misconfigured: missing ${envVar}`, 500);
    }
  }

  const bucket = Deno.env.get("AWS_S3_BUCKET")!;
  const roleArn = Deno.env.get("AWS_MEDIACONVERT_ROLE_ARN")!;

  try {
    // Authenticate the caller — allow internal service-role invocations
    // (e.g. from process-ai-fill) alongside user JWT requests.
    const authHeader = req.headers.get("Authorization") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const isServiceRoleRequest =
      authHeader.toLowerCase().startsWith("bearer ") &&
      authHeader.slice(7).trim() === serviceRoleKey;

    let userId: string | null = null;
    if (!isServiceRoleRequest) {
      try {
        const auth = await getAuthenticatedUser(req);
        userId = auth.user.id;
      } catch (err) {
        if (err instanceof AuthError) {
          return errorResponse("unauthorized", err.message, 401);
        }
        throw err;
      }
    }

    const body = await req.json();
    const { job_id } = body;

    if (!job_id) {
      return errorResponse("invalid_request", "job_id is required", 400);
    }

    const serviceClient = createServiceClient();

    // 1. Load and validate the job synchronously before returning 202
    const { data: job, error: jobError } = await serviceClient
      .from("job_queue")
      .select("*")
      .eq("id", job_id)
      .single();

    if (jobError || !job) {
      return errorResponse("not_found", "Job not found", 404);
    }

    // For user JWT requests, verify the caller owns the job.
    // Service-role requests (internal) skip this check.
    if (!isServiceRoleRequest && job.user_id !== userId) {
      return errorResponse("forbidden", "You do not own this job", 403);
    }

    if (job.type !== "video.export") {
      return errorResponse("invalid_request", `Unexpected job type: ${job.type}`, 400);
    }

    if (job.status !== "queued") {
      return errorResponse("conflict", `Job already ${job.status}`, 409);
    }

    // 2. Claim the job before returning
    const claimed = await claimJob(serviceClient, job_id);
    if (!claimed) {
      return errorResponse("conflict", "Job already claimed by another worker", 409);
    }

    console.log(`Processing export job ${job_id} for project ${job.project_id}`);

    // 3. Kick off background processing — the function stays alive via
    //    EdgeRuntime.waitUntil even after we return the 202 response.
    const bgTask = processExport(job_id, bucket, roleArn);
    EdgeRuntime.waitUntil(bgTask);

    // 4. Return immediately so the caller (process-ai-fill) isn't blocked
    return successResponse({ job_id, status: "accepted" }, 202);
  } catch (err) {
    console.error("Unhandled error in export-video:", err);
    return errorResponse("internal_error", "An unexpected error occurred", 500);
  }
});
