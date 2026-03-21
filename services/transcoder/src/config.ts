function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  redis: {
    url: required("REDIS_URL"),
  },
  supabase: {
    url: required("SUPABASE_URL"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  },
  aws: {
    accessKeyId: required("AWS_ACCESS_KEY_ID"),
    secretAccessKey: required("AWS_SECRET_ACCESS_KEY"),
    bucket: required("AWS_S3_BUCKET"),
    region: required("AWS_REGION"),
  },
  concurrency: parseInt(process.env.CONCURRENCY || "2", 10),
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "5000", 10),
} as const;
