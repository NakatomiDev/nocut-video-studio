import { handleCors } from "../_shared/cors.ts";
import { successResponse, errorResponse } from "../_shared/response.ts";
import {
  getVertexAccessToken,
  getGcpProjectId,
  getGcpRegion,
  vertexVeoUrl,
  vertexPollUrl,
} from "../_shared/gcp-auth.ts";

/**
 * Test endpoint: accepts two base64 images (first/last frame) and generates
 * a Veo transition video between them. Returns the video as base64 or a
 * download URL. No auth required — dev/test only.
 */

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "Only POST is allowed", 405);
  }

  try {
    const body = await req.json();
    const {
      first_image_base64,
      last_image_base64,
      prompt = "Smooth transition, seamless continuity, natural movement",
      duration = 5,
      model = "veo-2.0-generate-preview",
    } = body;

    if (!first_image_base64) {
      return errorResponse("missing_field", "first_image_base64 is required", 400);
    }

    let accessToken: string;
    try {
      accessToken = await getVertexAccessToken();
    } catch (err) {
      return errorResponse("config_error", (err as Error).message, 500);
    }
    const gcpProjectId = getGcpProjectId();
    const gcpRegion = getGcpRegion();

    console.log(`Starting Veo transition: model=${model}, duration=${duration}s, hasLastFrame=${!!last_image_base64}`);

    // Build instance using predictLongRunning format (bytesBase64Encoded).
    // The predictLongRunning endpoint is Vertex AI-style and does NOT support inlineData.
    const instance: Record<string, unknown> = {
      prompt: `${prompt}, ${duration} seconds`,
      image: {
        mimeType: "image/png",
        bytesBase64Encoded: first_image_base64,
      },
    };

    if (last_image_base64) {
      instance.lastFrame = {
        mimeType: "image/png",
        bytesBase64Encoded: last_image_base64,
      };
    }

    const parameters: Record<string, unknown> = {
      sampleCount: 1,
      aspectRatio: "16:9",
    };

    const generateUrl = vertexVeoUrl(gcpRegion, gcpProjectId, model);
    console.log(`Calling: ${generateUrl}`);

    const generateResponse = await fetch(generateUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ instances: [instance], parameters }),
    });

    if (!generateResponse.ok) {
      const errBody = await generateResponse.text();
      console.error(`Veo request failed: ${generateResponse.status} — ${errBody}`);
      return errorResponse("veo_request_failed", `Veo API returned ${generateResponse.status}: ${errBody}`, 502);
    }

    const operation = await generateResponse.json();
    const operationName = operation.name;
    console.log(`Operation started: ${operationName}`);

    // Poll for completion (up to 5 minutes)
    const maxWaitMs = 300_000;
    const pollIntervalMs = 5_000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));

      const pollResponse = await fetch(
        vertexPollUrl(gcpRegion, operationName),
        { headers: { "Authorization": `Bearer ${accessToken}` } },
      );

      if (!pollResponse.ok) {
        const errBody = await pollResponse.text();
        return errorResponse("veo_poll_failed", `Poll failed: ${pollResponse.status} — ${errBody}`, 502);
      }

      const pollResult = await pollResponse.json();
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);

      if (!pollResult.done) {
        console.log(`Still processing... ${elapsedSec}s elapsed`);
        continue;
      }

      console.log(`Veo completed after ${elapsedSec}s`);

      const response = pollResult.response ?? pollResult.result;
      const genVideoResp = response?.generateVideoResponse;

      // Check for safety filter rejection
      const raiReasons = genVideoResp?.raiMediaFilteredReasons;
      if (raiReasons && raiReasons.length > 0) {
        console.error("Safety filter triggered:", raiReasons);
        return errorResponse("safety_filtered", raiReasons[0], 422);
      }

      const generatedSamples =
        genVideoResp?.generatedSamples ??
        response?.generatedSamples ??
        [];
      const videoUri = generatedSamples[0]?.video?.uri;

      if (!videoUri) {
        console.error("No video URI in response:", JSON.stringify(pollResult).slice(0, 1000));
        return errorResponse("no_video", "Veo completed but returned no video URI. Try a different prompt.", 502);
      }

      // Download the video — handle gs:// URIs from Vertex AI
      let downloadUrl = videoUri;
      if (videoUri.startsWith("gs://")) {
        const gcsPath = videoUri.slice(5);
        const slashIdx = gcsPath.indexOf("/");
        const gcsBucket = gcsPath.slice(0, slashIdx);
        const gcsObject = encodeURIComponent(gcsPath.slice(slashIdx + 1));
        downloadUrl = `https://storage.googleapis.com/storage/v1/b/${gcsBucket}/o/${gcsObject}?alt=media`;
      }
      let videoResponse = await fetch(downloadUrl, {
        headers: { "Authorization": `Bearer ${accessToken}` },
      });
      if (!videoResponse.ok) {
        videoResponse = await fetch(downloadUrl);
      }
      if (!videoResponse.ok) {
        return errorResponse("download_failed", `Failed to download video: ${videoResponse.status}`, 502);
      }

      const videoBytes = new Uint8Array(await videoResponse.arrayBuffer());
      console.log(`Downloaded video: ${videoBytes.length} bytes`);

      // Return video as binary with metadata in headers
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Expose-Headers": "x-video-size, x-video-model, x-video-elapsed",
        "Content-Type": "video/mp4",
        "x-video-size": String(videoBytes.length),
        "x-video-model": model,
        "x-video-elapsed": String(elapsedSec),
      };
      return new Response(videoBytes, { status: 200, headers: corsHeaders });
    }

    return errorResponse("timeout", "Veo generation timed out after 5 minutes", 504);
  } catch (err) {
    console.error("Unhandled error:", err);
    return errorResponse("internal_error", (err as Error).message, 500);
  }
});
