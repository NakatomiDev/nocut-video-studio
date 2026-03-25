import { handleCors } from "../_shared/cors.ts";
import { successResponse, errorResponse } from "../_shared/response.ts";

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
      model = "veo-3.1-generate-preview",
    } = body;

    if (!first_image_base64) {
      return errorResponse("missing_field", "first_image_base64 is required", 400);
    }

    const apiKey = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!apiKey) {
      return errorResponse("config_error", "GOOGLE_AI_API_KEY is not set", 500);
    }

    console.log(`Starting Veo transition: model=${model}, duration=${duration}s, hasLastFrame=${!!last_image_base64}`);

    // Build instance using predictLongRunning format with inlineData.
    // See: https://ai.google.dev/gemini-api/docs/video#using-first-and-last-video-frames
    const instance: Record<string, unknown> = {
      prompt: `${prompt}, ${duration} seconds`,
      image: {
        inlineData: {
          mimeType: "image/png",
          data: first_image_base64,
        },
      },
    };

    if (last_image_base64) {
      instance.lastFrame = {
        inlineData: {
          mimeType: "image/png",
          data: last_image_base64,
        },
      };
    }

    const parameters: Record<string, unknown> = {
      sampleCount: 1,
      durationSeconds: duration,
      aspectRatio: "16:9",
    };

    const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`;
    console.log(`Calling: ${generateUrl}`);

    const generateResponse = await fetch(generateUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
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
        `https://generativelanguage.googleapis.com/v1beta/${operationName}`,
        { headers: { "x-goog-api-key": apiKey } },
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
      const generatedSamples =
        response?.generateVideoResponse?.generatedSamples ??
        response?.generatedSamples ??
        [];
      const videoUri = generatedSamples[0]?.video?.uri;

      if (!videoUri) {
        console.error("No video URI in response:", JSON.stringify(pollResult).slice(0, 1000));
        return errorResponse("no_video", "Veo completed but returned no video URI", 502);
      }

      // Download the video
      let videoResponse = await fetch(`${videoUri}?key=${apiKey}`);
      if (!videoResponse.ok) {
        videoResponse = await fetch(videoUri, { headers: { "x-goog-api-key": apiKey } });
      }
      if (!videoResponse.ok) {
        videoResponse = await fetch(`${videoUri}?alt=media&key=${apiKey}`);
      }
      if (!videoResponse.ok) {
        return errorResponse("download_failed", `Failed to download video: ${videoResponse.status}`, 502);
      }

      const videoBytes = new Uint8Array(await videoResponse.arrayBuffer());
      console.log(`Downloaded video: ${videoBytes.length} bytes`);

      // Return as base64
      const { encodeBase64 } = await import("https://deno.land/std@0.224.0/encoding/base64.ts");
      const videoBase64 = encodeBase64(videoBytes);

      return successResponse({
        video_base64: videoBase64,
        size_bytes: videoBytes.length,
        duration_seconds: duration,
        model,
        elapsed_seconds: elapsedSec,
      });
    }

    return errorResponse("timeout", "Veo generation timed out after 5 minutes", 504);
  } catch (err) {
    console.error("Unhandled error:", err);
    return errorResponse("internal_error", (err as Error).message, 500);
  }
});
