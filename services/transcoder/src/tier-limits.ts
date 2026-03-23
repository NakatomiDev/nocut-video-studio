export type Tier = "free" | "pro" | "business";

export interface TierLimit {
  max_file_size_bytes: number;
  max_duration_seconds: number;
  max_resolution_height: number;
}

export const TIER_LIMITS: Record<Tier, TierLimit> = {
  free: {
    max_file_size_bytes: 4 * 1024 * 1024 * 1024,
    max_duration_seconds: 300,
    max_resolution_height: 1080,
  },
  pro: {
    max_file_size_bytes: 10 * 1024 * 1024 * 1024,
    max_duration_seconds: 1800,
    max_resolution_height: 1080,
  },
  business: {
    max_file_size_bytes: 25 * 1024 * 1024 * 1024,
    max_duration_seconds: 7200,
    max_resolution_height: 2160,
  },
};

export interface TierViolation {
  code: string;
  message: string;
}

export function validateTierLimits(
  tier: Tier,
  fileSizeBytes: number,
  durationSeconds: number,
  resolution?: string,
): TierViolation | null {
  const limits = TIER_LIMITS[tier];

  if (fileSizeBytes > limits.max_file_size_bytes) {
    const maxGb = limits.max_file_size_bytes / (1024 * 1024 * 1024);
    return {
      code: "file_too_large",
      message: `File size exceeds the ${maxGb}GB limit for the ${tier} tier`,
    };
  }

  if (durationSeconds > limits.max_duration_seconds) {
    const maxMin = limits.max_duration_seconds / 60;
    return {
      code: "duration_exceeded",
      message: `Duration exceeds the ${maxMin}-minute limit for the ${tier} tier`,
    };
  }

  if (resolution) {
    const parts = resolution.split("x");
    const height = parseInt(parts[1] ?? parts[0], 10);
    if (!isNaN(height) && height > limits.max_resolution_height) {
      return {
        code: "resolution_exceeded",
        message: `Resolution exceeds the ${limits.max_resolution_height}p limit for the ${tier} tier`,
      };
    }
  }

  return null;
}
