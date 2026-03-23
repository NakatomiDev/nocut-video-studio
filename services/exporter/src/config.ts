function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  supabase: {
    url: required("SUPABASE_URL"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  },
  aws: {
    // When running on ECS, credentials come from the task role via the default credential chain.
    // Explicit keys are only needed for local development.
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    bucket: process.env.AWS_S3_BUCKET || required("S3_BUCKET"),
    region: required("AWS_REGION"),
    cloudfrontDomain: process.env.AWS_CLOUDFRONT_DOMAIN || "",
    cloudfrontKeypairId: process.env.AWS_CLOUDFRONT_KEYPAIR_ID || "",
    cloudfrontPrivateKey: process.env.AWS_CLOUDFRONT_PRIVATE_KEY || "",
  },
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "5000", 10),
  // Tier resolution limits
  resolutionLimits: {
    free: 720,
    pro: 1080,
    business: 2160,
  } as Record<string, number>,
} as const;
