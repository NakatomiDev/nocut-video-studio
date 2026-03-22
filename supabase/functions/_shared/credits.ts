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

/** Max fill duration per gap by tier (seconds). */
export const MAX_FILL_DURATION: Record<string, number> = {
  free: 1,
  pro: 5,
  business: 5,
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
 * Each whole second of fill = 1 credit.
 */
export function estimateGaps(
  gaps: Array<{ pre_cut_timestamp: number; post_cut_timestamp: number }>,
  maxFillDuration?: number,
): { estimates: GapEstimate[]; total_credits: number } {
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

    const credits = fillDuration; // 1 credit per second of fill

    estimates.push({
      pre_cut_timestamp: gap.pre_cut_timestamp,
      post_cut_timestamp: gap.post_cut_timestamp,
      gap_duration: gapDuration,
      fill_duration: fillDuration,
      credits,
    });
    totalCredits += credits;
  }

  return { estimates, total_credits: totalCredits };
}

/** Stripe top-up product configuration. */
export const TOPUP_PRODUCTS: Record<string, { credits: number; price_cents: number; name: string }> = {
  nocut_credits_10:  { credits: 10,  price_cents: 499,  name: "Starter – 10 credits" },
  nocut_credits_30:  { credits: 30,  price_cents: 1199, name: "Standard – 30 credits" },
  nocut_credits_75:  { credits: 75,  price_cents: 2499, name: "Value – 75 credits" },
  nocut_credits_200: { credits: 200, price_cents: 5499, name: "Bulk – 200 credits" },
};
