import { SupabaseClient } from "@supabase/supabase-js";

export interface CreditBalance {
  monthly: number;
  topup: number;
  total: number;
  breakdown: LedgerEntry[];
}

export interface LedgerEntry {
  id: string;
  type: string;
  credits_remaining: number;
  credits_granted: number;
  granted_at: string;
  expires_at: string;
}

/**
 * Fetch the user's credit balance from non-expired ledger entries.
 */
export async function getCreditBalance(
  supabase: SupabaseClient,
  userId: string,
): Promise<CreditBalance> {
  const { data, error } = await supabase
    .from("credit_ledger")
    .select("id, type, credits_remaining, credits_granted, granted_at, expires_at")
    .eq("user_id", userId)
    .gt("credits_remaining", 0)
    .gt("expires_at", new Date().toISOString())
    .order("granted_at", { ascending: true });

  if (error) throw error;

  const entries = (data ?? []) as LedgerEntry[];
  let monthly = 0;
  let topup = 0;

  for (const entry of entries) {
    if (entry.type === "monthly_allowance") {
      monthly += entry.credits_remaining;
    } else {
      topup += entry.credits_remaining;
    }
  }

  return {
    monthly,
    topup,
    total: monthly + topup,
    breakdown: entries,
  };
}

/** Max fill duration per gap by tier (seconds). Must match Veo API limits (4/6/8s). */
export const MAX_FILL_DURATION: Record<string, number> = {
  free: 4,
  pro: 8,
  business: 8,
};

export interface GapEstimate {
  pre_cut_timestamp: number;
  post_cut_timestamp: number;
  gap_duration: number;
  fill_duration: number;
  credits: number;
}

/**
 * Estimate fill duration and credits for a set of gaps.
 * Heuristic: fill_duration = min(gap_duration * 0.5, 3.0), rounded up to whole seconds.
 * Credits per second depend on the selected model (defaults to veo3.1-fast = 1 credit/sec).
 */
export function estimateGaps(
  gaps: Array<{ pre_cut_timestamp: number; post_cut_timestamp: number }>,
  maxFillDuration?: number,
  model: AiFillModel = DEFAULT_AI_FILL_MODEL,
): { estimates: GapEstimate[]; total_credits: number; credits_per_sec: number } {
  const creditsPerSec = MODEL_CREDITS_PER_SEC[model] ?? 1;
  const estimates: GapEstimate[] = [];
  let totalCredits = 0;

  for (const gap of gaps) {
    const gapDuration = Math.abs(gap.post_cut_timestamp - gap.pre_cut_timestamp);
    let fillDuration = Math.min(gapDuration * 0.5, 3.0);
    fillDuration = Math.ceil(fillDuration); // round up to whole seconds

    if (maxFillDuration !== undefined) {
      fillDuration = Math.min(fillDuration, maxFillDuration);
    }

    // Ensure at least 1 second for any non-zero gap
    if (fillDuration <= 0 && gapDuration > 0) {
      fillDuration = 1;
    }

    const credits = fillDuration * creditsPerSec;

    estimates.push({
      pre_cut_timestamp: gap.pre_cut_timestamp,
      post_cut_timestamp: gap.post_cut_timestamp,
      gap_duration: gapDuration,
      fill_duration: fillDuration,
      credits,
    });
    totalCredits += credits;
  }

  return { estimates, total_credits: totalCredits, credits_per_sec: creditsPerSec };
}

/** Stripe top-up product configuration. */
export const TOPUP_PRODUCTS: Record<string, { credits: number; price_cents: number; name: string }> = {
  nocut_credits_10:  { credits: 10,  price_cents: 499,  name: "Starter – 10 credits" },
  nocut_credits_40:  { credits: 40,  price_cents: 1499, name: "Standard – 40 credits" },
  nocut_credits_100: { credits: 100, price_cents: 3499, name: "Pro – 100 credits" },
  nocut_credits_250: { credits: 250, price_cents: 7999, name: "Studio – 250 credits" },
};

/**
 * Credit cost per second of AI fill, keyed by model.
 *
 * Costs are tuned so our cheapest top-up ($0.499/credit) stays profitable
 * against the Gemini API rates (March 2026):
 *
 *   Model                  API $/sec   Credits/sec   Break-even $/credit
 *   ─────────────────────  ─────────   ───────────   ───────────────────
 *   Veo 3.1 Fast (silent)    $0.10         1              $0.10
 *   Veo 3.1 Fast (audio)     $0.15         2              $0.075
 *   Veo 2                    $0.35         2              $0.175
 *   Veo 3.1 Std (silent)     $0.27         3              $0.09
 *   Veo 3.1 Std (audio)      $0.40         4              $0.10
 *   Veo 3 Std (audio)        $0.75         6              $0.125
 */
export type AiFillModel =
  | "veo3.1-fast"
  | "veo3.1-fast-audio"
  | "veo2"
  | "veo3.1-standard"
  | "veo3.1-standard-audio"
  | "veo3-standard-audio";

export const MODEL_CREDITS_PER_SEC: Record<AiFillModel, number> = {
  "veo3.1-fast":           1,
  "veo3.1-fast-audio":     2,
  "veo2":                  2,
  "veo3.1-standard":       3,
  "veo3.1-standard-audio": 4,
  "veo3-standard-audio":   6,
};

/** Default model for new projects. */
export const DEFAULT_AI_FILL_MODEL: AiFillModel = "veo3.1-fast";
