import {
  S3Client,
  CompleteMultipartUploadCommand,
} from "@aws-sdk/client-s3";

import { handleCors } from "../_shared/cors.ts";
import {
  getAuthenticatedUser,
  createServiceClient,
  AuthError,
} from "../_shared/auth.ts";
import { successResponse, errorResponse } from "../_shared/response.ts";

interface ChunkEntry {
  chunk_index: number;
  etag: string;
  completed_at: string;
}

const s3Client = new S3Client({
  region: Deno.env.get("AWS_REGION")!,
  credentials: {
    accessKeyId: Deno.env.get("AWS_ACCESS_KEY_ID")!,
    secretAccessKey: Deno.env.get("AWS_SECRET_ACCESS_KEY")!,
  },
});

const S3_BUCKET = Deno.env.get("AWS_S3_BUCKET")!;

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
    const { upload_session_id } = body;

    if (!upload_session_id || typeof upload_session_id !== "string") {
      return errorResponse("invalid_request", "upload_session_id is required and must be a string", 400);
    }

    // 3. Look up video and project by multipart_upload_id
    const serviceClient = createServiceClient();
    const { data: video, error: videoError } = await serviceClient
      .from("videos")
      .select("id, s3_key, total_chunks, upload_chunks, file_size_bytes, project_id, projects(id, user_id, status)")
      .eq("multipart_upload_id", upload_session_id)
      .single();

    if (videoError || !video) {
      console.error("Upload session lookup failed:", videoError);
      return errorResponse("not_found", "Upload session not found", 404);
    }

    const project = video.projects as { id: string; user_id: string; status: string };

    // 4. Ownership check
    if (project.user_id !== user.id) {
      return errorResponse("forbidden", "You do not own this upload session", 403);
    }

    // 5. Verify project status is still 'uploading'
    if (project.status !== "uploading") {
      return errorResponse(
        "conflict",
        `Upload already finalized. Current status: ${project.status}`,
        409,
      );
    }

    // 6. Verify all chunks are complete
    const chunks: ChunkEntry[] = (video.upload_chunks as ChunkEntry[]) || [];
    const totalChunks = video.total_chunks;

    if (chunks.length !== totalChunks) {
      return errorResponse(
        "incomplete_upload",
        `Only ${chunks.length} of ${totalChunks} chunks completed`,
        400,
      );
    }

    // Verify all indices 0..N-1 are present
    const receivedIndices = new Set(chunks.map((c) => c.chunk_index));
    const missingIndices: number[] = [];
    for (let i = 0; i < totalChunks; i++) {
      if (!receivedIndices.has(i)) {
        missingIndices.push(i);
      }
    }
    if (missingIndices.length > 0) {
      return errorResponse(
        "incomplete_upload",
        `Missing chunks: ${missingIndices.join(", ")}`,
        400,
      );
    }

    // 7. Build Parts array for S3 (sorted by PartNumber, 1-indexed)
    const parts = [...chunks]
      .sort((a, b) => a.chunk_index - b.chunk_index)
      .map((c) => ({
        ETag: c.etag,
        PartNumber: c.chunk_index + 1,
      }));

    // 8. Complete S3 multipart upload
    try {
      await s3Client.send(
        new CompleteMultipartUploadCommand({
          Bucket: S3_BUCKET,
          Key: video.s3_key,
          UploadId: upload_session_id,
          MultipartUpload: { Parts: parts },
        }),
      );
    } catch (err) {
      console.error("S3 CompleteMultipartUpload failed:", err);
      // Mark project as failed
      await serviceClient
        .from("projects")
        .update({ status: "failed" })
        .eq("id", project.id);
      return errorResponse("internal_error", "Failed to complete S3 upload", 500);
    }

    // 9. Update project status to 'transcoding'
    const { error: statusError } = await serviceClient
      .from("projects")
      .update({ status: "transcoding" })
      .eq("id", project.id);

    if (statusError) {
      console.error("Failed to update project status:", statusError);
      return errorResponse("internal_error", "Failed to update project status", 500);
    }

    // 10. Insert job_queue row for transcoding
    const { error: jobError } = await serviceClient
      .from("job_queue")
      .insert({
        project_id: project.id,
        user_id: user.id,
        type: "video.transcode",
        payload: { video_id: video.id, s3_key: video.s3_key },
      });

    if (jobError) {
      console.error("Failed to queue transcoding job:", jobError);
      // Non-fatal: project status is already updated, job can be retried
    }

    // 11. Estimate processing time (rough: 0.5s per MB)
    const fileSizeMb = (video.file_size_bytes || 0) / (1024 * 1024);
    const estimatedProcessingSeconds = Math.max(10, Math.ceil(fileSizeMb * 0.5));

    return successResponse({
      project_id: project.id,
      video_id: video.id,
      status: "transcoding",
      estimated_processing_seconds: estimatedProcessingSeconds,
    });
  } catch (err) {
    console.error("Unhandled error in upload-complete:", err);
    return errorResponse("internal_error", "An unexpected error occurred", 500);
  }
});
