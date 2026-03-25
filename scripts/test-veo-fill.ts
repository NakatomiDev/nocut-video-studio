#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env

/**
 * Standalone Veo API test script.
 *
 * Tests the AI fill video generation pipeline directly — no app, no Supabase,
 * no S3 needed. Sends first/last frame images to the Veo API and downloads
 * the generated video so you can verify frame conditioning is working.
 *
 * Usage:
 *   # Test with first + last frame (should match your frames)
 *   deno run --allow-net --allow-read --allow-write --allow-env scripts/test-veo-fill.ts \
 *     --first-frame frame_start.png --last-frame frame_end.png
 *
 *   # Test with only first frame
 *   deno run --allow-net --allow-read --allow-write --allow-env scripts/test-veo-fill.ts \
 *     --first-frame frame_start.png
 *
 *   # Test with NO frames (text-only) — should produce unrelated video
 *   deno run --allow-net --allow-read --allow-write --allow-env scripts/test-veo-fill.ts \
 *     --no-frames
 *
 *   # Specify model, prompt, duration
 *   deno run --allow-net --allow-read --allow-write --allow-env scripts/test-veo-fill.ts \
 *     --first-frame frame_start.png --last-frame frame_end.png \
 *     --model veo3.1-fast --prompt "Person talking at desk" --duration 4
 *
 * Environment:
 *   GOOGLE_AI_API_KEY — required
 *
 * Output:
 *   Saves the generated video to ./test-veo-output-{timestamp}.mp4
 */

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = parseArgs(Deno.args);

function parseArgs(raw: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (arg === "--no-frames" || arg === "--dry-run") {
      result[arg.slice(2)] = true;
    } else if (arg.startsWith("--") && i + 1 < raw.length && !raw[i + 1].startsWith("--")) {
      result[arg.slice(2)] = raw[++i];
    } else if (arg === "--help" || arg === "-h") {
      result["help"] = true;
    }
  }
  return result;
}

if (args["help"]) {
  console.log(`
Usage: deno run --allow-net --allow-read --allow-write --allow-env scripts/test-veo-fill.ts [OPTIONS]

Options:
  --first-frame <path>   Path to the first frame image (PNG/JPEG)
  --last-frame <path>    Path to the last frame image (PNG/JPEG)
  --no-frames            Test with no frame conditioning (text-only)
  --model <name>         Model name (default: veo3.1-fast)
                         Options: veo2, veo3.1-fast, veo3.1-fast-audio,
                                  veo3.1-standard, veo3.1-standard-audio,
                                  veo3-standard-audio
  --prompt <text>        Custom prompt (default: auto-generated)
  --audio-prompt <text>  Audio prompt (only for -audio models)
  --duration <seconds>   Fill duration in seconds (default: 4)
  --format <type>        Image format: "gemini" (default, correct) or "vertex" (for A/B testing)
  --output <path>        Output file path (default: auto-generated)
  --dry-run              Build the request and print it, don't send

Environment:
  GOOGLE_AI_API_KEY      Required. Your Google AI API key.
  `);
  Deno.exit(0);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const apiKey = Deno.env.get("GOOGLE_AI_API_KEY");
if (!apiKey) {
  console.error("ERROR: GOOGLE_AI_API_KEY environment variable is not set.");
  console.error("Set it with: export GOOGLE_AI_API_KEY=your-key-here");
  Deno.exit(1);
}

const MODEL_API_IDS: Record<string, string> = {
  "veo2":                  "veo-2.0-generate-preview",
  "veo3.1-fast":           "veo-3.1-fast-generate-preview",
  "veo3.1-fast-audio":     "veo-3.1-fast-generate-preview",
  "veo3.1-standard":       "veo-3.1-generate-preview",
  "veo3.1-standard-audio": "veo-3.1-generate-preview",
  "veo3-standard-audio":   "veo-3.0-generate-preview",
};

const model = (args["model"] as string) ?? "veo3.1-fast";
const apiModelId = MODEL_API_IDS[model] ?? "veo-3.1-fast-generate-preview";
const includeAudio = model.endsWith("-audio");
const duration = parseInt((args["duration"] as string) ?? "4", 10);
const noFrames = !!args["no-frames"];
const dryRun = !!args["dry-run"];
console.log("=== Veo API Test ===");
console.log(`Model:    ${model} → API ID: ${apiModelId}`);
console.log(`Duration: ${duration}s`);
console.log(`Audio:    ${includeAudio}`);
console.log(`Format:   bytesBase64Encoded (predictLongRunning requires Vertex AI-style format)`);
console.log(`Frames:   ${noFrames ? "NONE (text-only)" : "see below"}`);
console.log();

// ---------------------------------------------------------------------------
// Load frames
// ---------------------------------------------------------------------------

async function loadImageAsBase64(path: string): Promise<{ base64: string; mimeType: string }> {
  const bytes = await Deno.readFile(path);
  const ext = path.toLowerCase().split(".").pop();
  const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";

  // Convert to base64
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  console.log(`Loaded ${path}: ${bytes.length} bytes, ${mimeType}, base64 length: ${base64.length}`);
  return { base64, mimeType };
}

let firstFrame: { base64: string; mimeType: string } | null = null;
let lastFrame: { base64: string; mimeType: string } | null = null;

if (!noFrames) {
  const firstFramePath = args["first-frame"] as string;
  const lastFramePath = args["last-frame"] as string;

  if (!firstFramePath && !lastFramePath) {
    console.error("ERROR: Provide --first-frame and/or --last-frame, or use --no-frames for text-only test.");
    Deno.exit(1);
  }

  if (firstFramePath) {
    firstFrame = await loadImageAsBase64(firstFramePath);
  }
  if (lastFramePath) {
    lastFrame = await loadImageAsBase64(lastFramePath);
  }
}

console.log(`First frame: ${firstFrame ? "YES" : "NO"}`);
console.log(`Last frame:  ${lastFrame ? "YES" : "NO"}`);
console.log();

// ---------------------------------------------------------------------------
// Build request
// ---------------------------------------------------------------------------

const defaultPrompt = `Smooth transition video clip, ${duration} seconds, seamless continuity, natural head movement`;
let promptText = args["prompt"]
  ? `${args["prompt"]}, ${duration} seconds`
  : defaultPrompt;

if (includeAudio && args["audio-prompt"]) {
  promptText += `. Audio: ${args["audio-prompt"]}`;
}

const instance: Record<string, unknown> = { prompt: promptText };

if (firstFrame) {
  // predictLongRunning requires bytesBase64Encoded (Vertex AI-style), not inlineData
  instance.image = {
    mimeType: firstFrame.mimeType,
    bytesBase64Encoded: firstFrame.base64,
  };
}

if (lastFrame) {
  instance.lastFrame = {
    mimeType: lastFrame.mimeType,
    bytesBase64Encoded: lastFrame.base64,
  };
}

const parameters: Record<string, unknown> = {
  sampleCount: 1,
  durationSeconds: duration,
  aspectRatio: "16:9",
};

if (includeAudio) {
  parameters.generateAudio = true;
}

const requestBody = {
  instances: [instance],
  parameters,
};

console.log("=== Request ===");
console.log(`Endpoint: https://generativelanguage.googleapis.com/v1beta/models/${apiModelId}:predictLongRunning`);
console.log(`Prompt:   ${promptText}`);
console.log(`Body keys: instances[0] has: ${Object.keys(instance).join(", ")}`);
console.log(`Parameters: ${JSON.stringify(parameters)}`);

// Log a summary without the full base64 (which would be huge)
const bodySummary = {
  instances: [{
    prompt: promptText,
    image: firstFrame ? `<${firstFrame.base64.length} chars base64>` : undefined,
    lastFrame: lastFrame ? `<${lastFrame.base64.length} chars base64>` : undefined,
  }],
  parameters,
};
console.log(`Full body structure: ${JSON.stringify(bodySummary, null, 2)}`);
console.log();

if (dryRun) {
  console.log("Dry run — not sending request.");
  Deno.exit(0);
}

// ---------------------------------------------------------------------------
// Send request
// ---------------------------------------------------------------------------

const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${apiModelId}:predictLongRunning`;
console.log("Sending generation request...");

const generateResponse = await fetch(generateUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
  },
  body: JSON.stringify(requestBody),
});

if (!generateResponse.ok) {
  const body = await generateResponse.text();
  console.error(`ERROR: Generation request failed (${generateResponse.status}):`);
  console.error(body);
  Deno.exit(1);
}

const operation = await generateResponse.json();
const operationName = operation.name;
console.log(`Operation started: ${operationName}`);
console.log();

// ---------------------------------------------------------------------------
// Poll for completion
// ---------------------------------------------------------------------------

const pollBaseUrl = "https://generativelanguage.googleapis.com/v1beta";
const maxWaitMs = 300_000; // 5 minutes
const pollIntervalMs = 5_000;
const startTime = Date.now();

console.log("Polling for completion (max 5 minutes)...");

while (Date.now() - startTime < maxWaitMs) {
  await new Promise((r) => setTimeout(r, pollIntervalMs));
  const elapsed = Math.round((Date.now() - startTime) / 1000);

  const pollResponse = await fetch(
    `${pollBaseUrl}/${operationName}`,
    { headers: { "x-goog-api-key": apiKey } },
  );

  if (!pollResponse.ok) {
    const body = await pollResponse.text();
    console.error(`Poll failed (${pollResponse.status}): ${body}`);
    Deno.exit(1);
  }

  const pollResult = await pollResponse.json();

  if (pollResult.done) {
    console.log(`\nCompleted after ${elapsed}s`);

    const response = pollResult.response ?? pollResult.result;
    const generatedSamples =
      response?.generateVideoResponse?.generatedSamples ??
      response?.generatedSamples ??
      [];

    if (generatedSamples.length === 0) {
      console.error("ERROR: Veo completed but returned no generated samples.");
      console.error("This usually means the content was blocked by safety filters.");
      console.error("Full response:", JSON.stringify(pollResult, null, 2));
      Deno.exit(1);
    }

    const videoUri = generatedSamples[0]?.video?.uri;
    if (!videoUri) {
      console.error("ERROR: No video URI in response.");
      console.error("Full response:", JSON.stringify(pollResult, null, 2));
      Deno.exit(1);
    }

    console.log(`Video URI: ${videoUri}`);

    // Download video (same fallback logic as process-ai-fill)
    let videoResponse = await fetch(`${videoUri}?key=${apiKey}`);
    if (!videoResponse.ok) {
      console.log(`Download with query key failed (${videoResponse.status}), trying header auth...`);
      videoResponse = await fetch(videoUri, {
        headers: { "x-goog-api-key": apiKey },
      });
    }
    if (!videoResponse.ok) {
      console.log(`Download with header failed (${videoResponse.status}), trying alt=media...`);
      videoResponse = await fetch(`${videoUri}?alt=media&key=${apiKey}`);
    }
    if (!videoResponse.ok) {
      console.error(`ERROR: All download attempts failed (${videoResponse.status})`);
      Deno.exit(1);
    }

    const videoBytes = new Uint8Array(await videoResponse.arrayBuffer());
    const outputPath = (args["output"] as string) ??
      `test-veo-output-${model}-${noFrames ? "noframes" : "frames"}-${Date.now()}.mp4`;
    await Deno.writeFile(outputPath, videoBytes);

    console.log(`\n=== SUCCESS ===`);
    console.log(`Video saved to: ${outputPath}`);
    console.log(`Size: ${(videoBytes.length / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Model: ${model}`);
    console.log(`Frame conditioning: first=${!!firstFrame}, last=${!!lastFrame}`);
    console.log();
    console.log("Compare this video against your source frames to verify conditioning works.");
    if (noFrames) {
      console.log("This was a TEXT-ONLY test — the video should NOT match any specific frames.");
    } else {
      console.log("The first frame of the video should closely match your --first-frame image.");
      console.log("The last frame of the video should closely match your --last-frame image.");
    }
    Deno.exit(0);
  }

  // Still processing
  const metadata = pollResult.metadata;
  Deno.stdout.writeSync(new TextEncoder().encode(`\r  ${elapsed}s elapsed...`));
}

console.error(`\nERROR: Timed out after ${maxWaitMs / 1000}s`);
Deno.exit(1);
