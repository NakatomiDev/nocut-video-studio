import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { handleCors } from "../_shared/cors.ts";
import { getAuthenticatedUser, createServiceClient, AuthError } from "../_shared/auth.ts";
import { successResponse, errorResponse } from "../_shared/response.ts";

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

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { user } = await getAuthenticatedUser(req);
    const { s3_key } = await req.json();

    if (!s3_key || typeof s3_key !== "string") {
      return errorResponse("bad_request", "s3_key is required", 400);
    }

    // Reject path traversal attempts and normalize the key
    if (s3_key.includes("..") || s3_key.includes("//") || s3_key.includes("\\")) {
      return errorResponse("bad_request", "Invalid s3_key", 400);
    }

    // Verify the key belongs to this user.
    // uploads/{user_id}/... — direct ownership via path prefix.
    // ai-fills/{project_id}/... — ownership verified via project lookup.
    if (s3_key.startsWith(`uploads/${user.id}/`)) {
      // Direct ownership — OK
    } else if (s3_key.startsWith("ai-fills/")) {
      // Extract project_id from the path: ai-fills/{project_id}/...
      const parts = s3_key.split("/");
      const projectId = parts[1];
      if (!projectId) {
        return errorResponse("bad_request", "Invalid ai-fills path", 400);
      }
      const svc = createServiceClient();
      const { data: proj } = await svc
        .from("projects")
        .select("id")
        .eq("id", projectId)
        .eq("user_id", user.id)
        .single();
      if (!proj) {
        return errorResponse("unauthorized", "Unauthorized", 403);
      }
    } else {
      return errorResponse("unauthorized", "Unauthorized", 403);
    }

    const command = new GetObjectCommand({
      Bucket: Deno.env.get("AWS_S3_BUCKET")!,
      Key: s3_key,
    });

    const url = await getSignedUrl(getS3Client(), command, { expiresIn: 3600 });

    return successResponse({ url });
  } catch (err) {
    if (err instanceof AuthError) {
      return errorResponse("unauthorized", err.message, 401);
    }
    console.error("get-signed-url error:", err);
    return errorResponse("internal_error", "Failed to generate signed URL", 500);
  }
});
