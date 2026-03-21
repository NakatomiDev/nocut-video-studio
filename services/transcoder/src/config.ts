function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function buildRedisUrl(): string {
  // Support either a full REDIS_URL or individual REDIS_HOST/REDIS_PORT/REDIS_TLS components
  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }
  const host = required("REDIS_HOST");
  const port = process.env.REDIS_PORT || "6379";
  const password = process.env.REDIS_PASSWORD || "";
  const useTls = process.env.REDIS_TLS === "true";
  const protocol = useTls ? "rediss" : "redis";
  const auth = password ? `:${encodeURIComponent(password)}@` : "";
  return `${protocol}://${auth}${host}:${port}`;
}

export const config = {
  redis: {
    url: buildRedisUrl(),
  },
  supabase: {
    url: required("SUPABASE_URL"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  },
  aws: {
    // When running on ECS, credentials come from the task role via the SDK default credential chain.
    // Explicit keys are only needed for local development.
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    bucket: process.env.AWS_S3_BUCKET || required("S3_BUCKET"),
    region: required("AWS_REGION"),
  },
  concurrency: parseInt(process.env.WORKER_CONCURRENCY || process.env.CONCURRENCY || "2", 10),
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "5000", 10),
} as const;
