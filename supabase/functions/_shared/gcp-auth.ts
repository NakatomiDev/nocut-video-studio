/**
 * GCP Vertex AI authentication for Supabase Edge Functions (Deno).
 *
 * Uses a GCP service account key (stored as the `GCP_SERVICE_ACCOUNT_KEY` env
 * var — a JSON string) to mint short-lived OAuth2 access tokens via the
 * standard JWT-bearer flow. Tokens are cached in-memory and refreshed
 * automatically before expiry.
 *
 * Also exports Vertex AI URL builders for Veo and Gemini endpoints.
 */

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

export function getGcpProjectId(): string {
  const projectId = Deno.env.get("GCP_PROJECT_ID");
  if (!projectId) {
    throw new Error(
      "GCP_PROJECT_ID environment variable is not set. " +
      "This is required to construct Vertex AI endpoints and avoid sending " +
      "traffic to an unintended GCP project.",
    );
  }
  return projectId;
}

export function getGcpRegion(): string {
  const region = Deno.env.get("GCP_REGION");
  if (!region) {
    throw new Error(
      "GCP_REGION environment variable is not set. " +
      "This is required to construct Vertex AI endpoints and avoid sending " +
      "traffic to an unintended GCP region.",
    );
  }
  return region;
}

// ---------------------------------------------------------------------------
// Vertex AI URL builders
// ---------------------------------------------------------------------------

export function vertexVeoUrl(region: string, projectId: string, modelId: string): string {
  return `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${modelId}:predictLongRunning`;
}

export function vertexGeminiUrl(region: string, projectId: string, modelId: string): string {
  return `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${modelId}:generateContent`;
}

export function vertexPollUrl(region: string, operationName: string): string {
  // If operationName is already an absolute URL, return it as-is. Otherwise
  // treat it as a relative resource name (e.g. "projects/...") and prefix
  // the regional Vertex AI endpoint.
  if (operationName.startsWith("http://") || operationName.startsWith("https://")) {
    return operationName;
  }

  const normalizedOperationName = operationName.replace(/^\/+/, "");
  return `https://${region}-aiplatform.googleapis.com/v1/${normalizedOperationName}`;
}

// ---------------------------------------------------------------------------
// OAuth2 token cache
// ---------------------------------------------------------------------------

let _cachedToken: string | null = null;
let _tokenExpiresAt = 0; // epoch ms

/**
 * Return a valid GCP access token, minting a new one when necessary.
 * The token is cached in-memory and refreshed ~100 s before expiry.
 */
export async function getVertexAccessToken(): Promise<string> {
  if (_cachedToken && Date.now() < _tokenExpiresAt) {
    return _cachedToken;
  }

  const saKeyJson = Deno.env.get("GCP_SERVICE_ACCOUNT_KEY");
  if (!saKeyJson) {
    throw new Error(
      "GCP_SERVICE_ACCOUNT_KEY is not set — cannot authenticate with Vertex AI. " +
      "Set this Supabase secret to the full JSON contents of your GCP service account key file.",
    );
  }

  const saKey = JSON.parse(saKeyJson) as {
    client_email: string;
    private_key: string;
    token_uri?: string;
  };

  const tokenUri = saKey.token_uri ?? "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);

  // Build JWT
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: saKey.client_email,
    sub: saKey.client_email,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/cloud-platform",
  };

  const enc = new TextEncoder();
  const headerB64 = base64UrlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import the RSA private key and sign
  const privateKey = await importPkcs8Key(saKey.private_key);
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, enc.encode(unsignedToken)),
  );
  const signedJwt = `${unsignedToken}.${base64UrlEncode(signature)}`;

  // Exchange JWT for access token
  const tokenResponse = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(signedJwt)}`,
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    throw new Error(`GCP token exchange failed (${tokenResponse.status}): ${body}`);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    expires_in?: number;
  };

  _cachedToken = tokenData.access_token;
  // Refresh before actual expiry to avoid edge-case failures.
  // Use a safe default if expires_in is missing/invalid and clamp the refresh skew.
  const DEFAULT_EXPIRES_IN_SEC = 3600;
  const rawExpiresIn = typeof tokenData.expires_in === "number" ? tokenData.expires_in : DEFAULT_EXPIRES_IN_SEC;
  const validExpiresIn = Number.isFinite(rawExpiresIn) && rawExpiresIn > 0 ? rawExpiresIn : DEFAULT_EXPIRES_IN_SEC;
  const refreshSkewSec = Math.min(100, validExpiresIn);
  const effectiveTtlSec = Math.max(validExpiresIn - refreshSkewSec, 0);
  _tokenExpiresAt = Date.now() + effectiveTtlSec * 1000;

  return _cachedToken;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPkcs8Key(pem: string): Promise<CryptoKey> {
  // Strip PEM header/footer and whitespace
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");

  const binaryStr = atob(pemBody);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  return crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}
