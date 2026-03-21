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
    const { upload_session_id, chunk_index, etag } = body;

    if (!upload_session_id || typeof upload_session_id !== "string") {
      return errorResponse("invalid_request", "upload_session_id is required and must be a string", 400);
    }
    if (chunk_index === undefined || typeof chunk_index !== "number" || !Number.isInteger(chunk_index) || chunk_index < 0) {
      return errorResponse("invalid_request", "chunk_index is required and must be a non-negative integer", 400);
    }
    if (!etag || typeof etag !== "string") {
      return errorResponse("invalid_request", "etag is required and must be a string", 400);
    }

    // 3. Look up video by multipart_upload_id
    const serviceClient = createServiceClient();
    const { data: video, error: videoError } = await serviceClient
      .from("videos")
      .select("id, total_chunks, upload_chunks, project_id, projects(user_id)")
      .eq("multipart_upload_id", upload_session_id)
      .single();

    if (videoError || !video) {
      console.error("Upload session lookup failed:", videoError);
      return errorResponse("not_found", "Upload session not found", 404);
    }

    // 4. Ownership check
    const projectOwner = (video.projects as { user_id: string })?.user_id;
    if (projectOwner !== user.id) {
      return errorResponse("forbidden", "You do not own this upload session", 403);
    }

    // 5. Validate chunk_index range
    if (chunk_index >= video.total_chunks) {
      return errorResponse(
        "invalid_request",
        `chunk_index ${chunk_index} is out of range (0-${video.total_chunks - 1})`,
        400,
      );
    }

    // 6. Update upload_chunks — idempotent (replace existing entry for same chunk_index)
    const existingChunks: ChunkEntry[] = (video.upload_chunks as ChunkEntry[]) || [];
    const filtered = existingChunks.filter((c) => c.chunk_index !== chunk_index);
    const updatedChunks: ChunkEntry[] = [
      ...filtered,
      { chunk_index, etag, completed_at: new Date().toISOString() },
    ];

    const { error: updateError } = await serviceClient
      .from("videos")
      .update({ upload_chunks: updatedChunks })
      .eq("id", video.id);

    if (updateError) {
      console.error("Failed to update upload_chunks:", updateError);
      return errorResponse("internal_error", "Failed to record chunk completion", 500);
    }

    // 7. Return progress
    const chunksCompleted = updatedChunks.length;
    const chunksTotal = video.total_chunks;
    const progressPercent = Math.round((chunksCompleted / chunksTotal) * 100);

    return successResponse({
      chunks_completed: chunksCompleted,
      chunks_total: chunksTotal,
      progress_percent: progressPercent,
    });
  } catch (err) {
    console.error("Unhandled error in upload-chunk-complete:", err);
    return errorResponse("internal_error", "An unexpected error occurred", 500);
  }
});
