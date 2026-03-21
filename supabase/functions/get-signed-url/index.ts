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
    const user = await getAuthenticatedUser(req);
    const { s3_key } = await req.json();

    if (!s3_key || typeof s3_key !== "string") {
      return errorResponse("s3_key is required", 400);
    }

    // Verify the key belongs to this user (keys start with uploads/{user_id}/)
    if (!s3_key.startsWith(`uploads/${user.id}/`)) {
      return errorResponse("Unauthorized", 403);
    }

    const command = new GetObjectCommand({
      Bucket: Deno.env.get("AWS_S3_BUCKET")!,
      Key: s3_key,
    });

    const url = await getSignedUrl(getS3Client(), command, { expiresIn: 3600 });

    return successResponse({ url });
  } catch (err) {
    if (err instanceof AuthError) {
      return errorResponse(err.message, 401);
    }
    console.error("get-signed-url error:", err);
    return errorResponse("Failed to generate signed URL", 500);
  }
});
