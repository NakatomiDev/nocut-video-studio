import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { handleCors } from "../_shared/cors.ts";
import {
  getAuthenticatedUser,
  createServiceClient,
  AuthError,
} from "../_shared/auth.ts";
import { successResponse, errorResponse } from "../_shared/response.ts";
import {
  type Tier,
  ALLOWED_MIME_TYPES,
  MIME_TO_EXTENSION,
  validateTierLimits,
} from "../_shared/tier-limits.ts";

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB

// Lazy-init so OPTIONS preflight never crashes due to missing env vars
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

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "Only POST is allowed", 405);
  }

  try {
    // 1. Authenticate
    let user;
    try {
      const auth = await getAuthenticatedUser(req);
      user = auth.user;
    } catch (err) {
      if (err instanceof AuthError) {
        return errorResponse("unauthorized", err.message, 401);
      }
      throw err;
    }

    // 2. Parse and validate request body
    const body = await req.json();
    const { filename, file_size_bytes, mime_type, duration_seconds, resolution } = body;
    const title = body.title || filename?.replace(/\.[^.]+$/, "") || "Untitled Project";

    if (!filename || typeof filename !== "string") {
      return errorResponse("invalid_request", "filename is required and must be a string", 400);
    }
    if (!file_size_bytes || typeof file_size_bytes !== "number" || file_size_bytes <= 0) {
      return errorResponse("invalid_request", "file_size_bytes is required and must be a positive number", 400);
    }
    if (!mime_type || typeof mime_type !== "string") {
      return errorResponse("invalid_request", "mime_type is required and must be a string", 400);
    }
    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mime_type)) {
      return errorResponse(
        "unsupported_format",
        `Unsupported mime type: ${mime_type}. Allowed: ${ALLOWED_MIME_TYPES.join(", ")}`,
        415,
      );
    }
    if (!duration_seconds || typeof duration_seconds !== "number" || duration_seconds <= 0) {
      return errorResponse("invalid_request", "duration_seconds is required and must be a positive number", 400);
    }
    if (resolution !== undefined && typeof resolution !== "string") {
      return errorResponse("invalid_request", "resolution must be a string if provided", 400);
    }

    // 3. Fetch user tier
    const serviceClient = createServiceClient();
    const { data: userRow, error: userError } = await serviceClient
      .from("users")
      .select("tier")
      .eq("id", user.id)
      .single();

    if (userError || !userRow) {
      return errorResponse(
        "user_profile_not_found",
        "User profile not found. Please contact support.",
        404,
      );
    }

    const tier = userRow.tier as Tier;

    // 4. Validate tier limits
    const violation = validateTierLimits(tier, file_size_bytes, duration_seconds, resolution);
    if (violation) {
      return errorResponse(violation.code, violation.message, 413);
    }

    // 5. Create project
    const { data: project, error: projectError } = await serviceClient
      .from("projects")
      .insert({ user_id: user.id, title, status: "uploading" })
      .select("id")
      .single();

    if (projectError || !project) {
      console.error("Failed to create project:", projectError);
      return errorResponse("internal_error", "Failed to create project", 500);
    }

    const projectId = project.id;
    const extension = MIME_TO_EXTENSION[mime_type] ?? "mp4";
    const s3Key = `uploads/${user.id}/${projectId}/source.${extension}`;
    const totalChunks = Math.ceil(file_size_bytes / CHUNK_SIZE);
    const s3Bucket = Deno.env.get("AWS_S3_BUCKET")!;

    // 6. Initiate S3 multipart upload
    let uploadId: string;
    try {
      const createCmd = new CreateMultipartUploadCommand({
        Bucket: s3Bucket,
        Key: s3Key,
        ContentType: mime_type,
      });
      const createResult = await getS3Client().send(createCmd);
      uploadId = createResult.UploadId!;
    } catch (err) {
      console.error("Failed to initiate S3 multipart upload:", err);
      await serviceClient.from("projects").delete().eq("id", projectId);
      return errorResponse("internal_error", "Failed to initiate upload", 500);
    }

    // 7. Create video record
    const { data: video, error: videoError } = await serviceClient
      .from("videos")
      .insert({
        project_id: projectId,
        s3_key: s3Key,
        duration: duration_seconds,
        resolution: resolution ?? null,
        format: mime_type,
        file_size_bytes,
        multipart_upload_id: uploadId,
        total_chunks: totalChunks,
      })
      .select("id")
      .single();

    if (videoError || !video) {
      console.error("Failed to create video record:", videoError);
      // Clean up: abort multipart upload and delete project
      try {
        await getS3Client().send(
          new AbortMultipartUploadCommand({
            Bucket: s3Bucket,
            Key: s3Key,
            UploadId: uploadId,
          }),
        );
      } catch { /* best-effort cleanup */ }
      await serviceClient.from("projects").delete().eq("id", projectId);
      return errorResponse("internal_error", "Failed to create video record", 500);
    }

    // 8. Generate presigned UploadPart URLs
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
    const presignedUrls = await Promise.all(
      Array.from({ length: totalChunks }, async (_, i) => {
        const cmd = new UploadPartCommand({
          Bucket: s3Bucket,
          Key: s3Key,
          UploadId: uploadId,
          PartNumber: i + 1, // S3 parts are 1-indexed
        });
        const url = await getSignedUrl(getS3Client(), cmd, { expiresIn: 3600 });
        return { chunk_index: i, url, expires_at: expiresAt };
      }),
    );

    // 9. Return success
    return successResponse({
      project_id: projectId,
      video_id: video.id,
      upload_session_id: uploadId,
      chunk_size_bytes: CHUNK_SIZE,
      total_chunks: totalChunks,
      presigned_urls: presignedUrls,
    });
  } catch (err) {
    console.error("Unhandled error in upload-initiate:", err);
    return errorResponse("internal_error", "An unexpected error occurred", 500);
  }
});
