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
  return Deno.env.get("GCP_PROJECT_ID") ?? "nocut-ai-dev";
}

export function getGcpRegion(): string {
  return Deno.env.get("GCP_REGION") ?? "us-central1";
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
  // operationName already includes the full path, but if it starts with
  // "projects/" we need to prefix the regional endpoint.
  return `https://${region}-aiplatform.googleapis.com/v1/${operationName}`;
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
    expires_in: number;
  };

  _cachedToken = tokenData.access_token;
  // Refresh 100 s before actual expiry to avoid edge-case failures
  _tokenExpiresAt = Date.now() + (tokenData.expires_in - 100) * 1000;

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
