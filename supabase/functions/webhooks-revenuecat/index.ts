import { createServiceClient } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

// RevenueCat product → tier mapping
// Includes both RevenueCat product IDs (app stores) and Stripe price IDs (web).
// Stripe price IDs are loaded from env vars since they differ between test/prod.
const PRODUCT_TIER_MAP: Record<string, "pro" | "business"> = {
  nocut_pro_monthly: "pro",
  nocut_pro_annual: "pro",
  nocut_business_monthly: "business",
  nocut_business_annual: "business",
};

// Map Stripe price IDs → tiers from environment variables
const stripePriceMappings: [string, "pro" | "business"][] = [
  ["STRIPE_PRICE_PRO_MONTHLY", "pro"],
  ["STRIPE_PRICE_PRO_ANNUAL", "pro"],
  ["STRIPE_PRICE_BUSINESS_MONTHLY", "business"],
  ["STRIPE_PRICE_BUSINESS_ANNUAL", "business"],
];
for (const [envVar, tier] of stripePriceMappings) {
  const priceId = Deno.env.get(envVar);
  if (priceId) {
    PRODUCT_TIER_MAP[priceId] = tier;
  }
}

// Monthly credit allocation per tier
// Credits are model-weighted: 1 credit = 1 sec of Veo 3.1 Fast,
// 2 credits = 1 sec of Veo 2, 4 credits = 1 sec of Veo 3.1 Standard (audio), etc.
const TIER_CREDITS: Record<string, number> = {
  pro: 40,
  business: 120,
  free: 5,
};

interface RevenueCatEvent {
  type: string;
  app_user_id: string;
  product_id?: string;
  new_product_id?: string;
  expiration_at_ms?: number;
  period_type?: string;
  // Additional fields we may use
  [key: string]: unknown;
}

interface RevenueCatWebhookBody {
  api_version: string;
  event: RevenueCatEvent;
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    // 1. Verify webhook secret
    const webhookSecret = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
    if (!webhookSecret) {
      console.error("REVENUECAT_WEBHOOK_SECRET is not configured");
      return jsonResponse({ error: "Webhook not configured" }, 500);
    }
    const authHeader = req.headers.get("Authorization");
    if (authHeader !== `Bearer ${webhookSecret}`) {
      console.error("RevenueCat webhook auth failed");
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // 2. Parse event
    const body = (await req.json()) as RevenueCatWebhookBody;
    const event = body.event;

    if (!event?.type || !event?.app_user_id) {
      console.error("Invalid webhook payload: missing type or app_user_id");
      return jsonResponse({ ok: true }); // Return 200 to avoid retries
    }

    const serviceClient = createServiceClient();
    const userId = event.app_user_id;

    // Verify user exists
    const { data: user, error: userError } = await serviceClient
      .from("users")
      .select("id, tier")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      // Try matching by revenuecat_id
      const { data: rcUser, error: rcError } = await serviceClient
        .from("users")
        .select("id, tier")
        .eq("revenuecat_id", userId)
        .single();

      if (rcError || !rcUser) {
        console.error(`User not found for app_user_id: ${userId}`);
        return jsonResponse({ ok: true }); // 200 to prevent retries for unknown users
      }
      // Use the matched user
      return await handleEvent(serviceClient, event, rcUser.id, rcUser.tier);
    }

    return await handleEvent(serviceClient, event, user.id, user.tier);
  } catch (err) {
    console.error("Unhandled error in webhooks-revenuecat:", err);
    // Always return 200 to prevent infinite retries
    return jsonResponse({ ok: true, error: "internal_error" });
  }
});

async function handleEvent(
  serviceClient: ReturnType<typeof createServiceClient>,
  event: RevenueCatEvent,
  userId: string,
  currentTier: string,
): Promise<Response> {
  console.log(`RevenueCat event: ${event.type} for user ${userId}`);

  switch (event.type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
      return await handlePurchaseOrRenewal(serviceClient, event, userId);

    case "PRODUCT_CHANGE":
      return await handleProductChange(serviceClient, event, userId, currentTier);

    case "CANCELLATION":
      return await handleCancellation(serviceClient, userId);

    case "EXPIRATION":
      return await handleExpiration(serviceClient, userId);

    case "BILLING_ISSUE":
      console.warn(`Billing issue for user ${userId}, product: ${event.product_id}`);
      return jsonResponse({ ok: true });

    case "UNCANCELLATION":
      // No cancel_at_period_end column — just log
      console.log(`Uncancellation for user ${userId}`);
      return jsonResponse({ ok: true });

    default:
      console.log(`Unhandled RevenueCat event type: ${event.type}`);
      return jsonResponse({ ok: true });
  }
}

// ---------------------------------------------------------------------------
// INITIAL_PURCHASE / RENEWAL
// ---------------------------------------------------------------------------
async function handlePurchaseOrRenewal(
  serviceClient: ReturnType<typeof createServiceClient>,
  event: RevenueCatEvent,
  userId: string,
): Promise<Response> {
  const productId = event.product_id ?? "";
  const tier = PRODUCT_TIER_MAP[productId];

  if (!tier) {
    console.error(`Unknown product_id: ${productId}`);
    return jsonResponse({ ok: true });
  }

  const credits = TIER_CREDITS[tier];
  const expiresAt = new Date(Date.now() + 2 * 30 * 24 * 60 * 60 * 1000).toISOString(); // now + ~2 months

  // Update user tier
  await serviceClient
    .from("users")
    .update({ tier, updated_at: new Date().toISOString() })
    .eq("id", userId);

  // Insert credit_ledger row
  const { data: ledger, error: ledgerError } = await serviceClient
    .from("credit_ledger")
    .insert({
      user_id: userId,
      type: "monthly_allowance",
      credits_granted: credits,
      credits_remaining: credits,
      expires_at: expiresAt,
      revenuecat_event_id: eventId(event),
    })
    .select("id")
    .single();

  if (ledgerError) {
    console.error("Failed to insert credit_ledger:", ledgerError);
    return jsonResponse({ ok: true, error: "ledger_insert_failed" });
  }

  // Insert credit_transactions row
  await serviceClient
    .from("credit_transactions")
    .insert({
      user_id: userId,
      type: "allocation",
      credits,
      ledger_entries: [{ ledger_id: ledger.id, credits_allocated: credits }],
      reason: `monthly_allowance_${tier}`,
    });

  console.log(`Allocated ${credits} ${tier} credits for user ${userId}`);
  return jsonResponse({ ok: true });
}

// ---------------------------------------------------------------------------
// PRODUCT_CHANGE (upgrade/downgrade)
// ---------------------------------------------------------------------------
async function handleProductChange(
  serviceClient: ReturnType<typeof createServiceClient>,
  event: RevenueCatEvent,
  userId: string,
  currentTier: string,
): Promise<Response> {
  const newProductId = event.new_product_id ?? event.product_id ?? "";
  const newTier = PRODUCT_TIER_MAP[newProductId];

  if (!newTier) {
    console.error(`Unknown new product_id: ${newProductId}`);
    return jsonResponse({ ok: true });
  }

  // Update user tier
  await serviceClient
    .from("users")
    .update({ tier: newTier, updated_at: new Date().toISOString() })
    .eq("id", userId);

  // If upgrade: allocate prorated credits
  const oldCredits = TIER_CREDITS[currentTier] ?? 0;
  const newCredits = TIER_CREDITS[newTier];

  if (newCredits > oldCredits) {
    // Prorate: estimate ~30 days in a period, calculate days remaining
    // Use expiration_at_ms if available, otherwise assume 15 days remaining (mid-period)
    let daysRemaining = 15;
    if (event.expiration_at_ms) {
      const msRemaining = event.expiration_at_ms - Date.now();
      daysRemaining = Math.max(1, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));
    }
    const proratedCredits = Math.ceil((newCredits - oldCredits) * (daysRemaining / 30));
    const expiresAt = new Date(Date.now() + 2 * 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: ledger, error: ledgerError } = await serviceClient
      .from("credit_ledger")
      .insert({
        user_id: userId,
        type: "monthly_allowance",
        credits_granted: proratedCredits,
        credits_remaining: proratedCredits,
        expires_at: expiresAt,
        revenuecat_event_id: eventId(event),
      })
      .select("id")
      .single();

    if (!ledgerError && ledger) {
      await serviceClient
        .from("credit_transactions")
        .insert({
          user_id: userId,
          type: "allocation",
          credits: proratedCredits,
          ledger_entries: [{ ledger_id: ledger.id, credits_allocated: proratedCredits }],
          reason: `upgrade_proration_${currentTier}_to_${newTier}`,
        });

      console.log(`Prorated ${proratedCredits} credits for upgrade ${currentTier} → ${newTier}, user ${userId}`);
    }
  }

  return jsonResponse({ ok: true });
}

// ---------------------------------------------------------------------------
// CANCELLATION
// ---------------------------------------------------------------------------
async function handleCancellation(
  serviceClient: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<Response> {
  // Credits remain valid until their expiry — no credit action needed.
  // The users table lacks a cancel_at_period_end column, so just log.
  console.log(`Cancellation for user ${userId} — credits remain until expiry`);
  return jsonResponse({ ok: true });
}

// ---------------------------------------------------------------------------
// EXPIRATION
// ---------------------------------------------------------------------------
async function handleExpiration(
  serviceClient: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<Response> {
  // Downgrade to free tier
  await serviceClient
    .from("users")
    .update({ tier: "free", updated_at: new Date().toISOString() })
    .eq("id", userId);

  // Allocate free-tier credits (5, expires in 2 months)
  const credits = TIER_CREDITS["free"];
  const expiresAt = new Date(Date.now() + 2 * 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: ledger, error: ledgerError } = await serviceClient
    .from("credit_ledger")
    .insert({
      user_id: userId,
      type: "monthly_allowance",
      credits_granted: credits,
      credits_remaining: credits,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (!ledgerError && ledger) {
    await serviceClient
      .from("credit_transactions")
      .insert({
        user_id: userId,
        type: "allocation",
        credits,
        ledger_entries: [{ ledger_id: ledger.id, credits_allocated: credits }],
        reason: "free_tier_downgrade",
      });
  }

  console.log(`Downgraded user ${userId} to free tier with ${credits} credits`);
  return jsonResponse({ ok: true });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eventId(event: RevenueCatEvent): string {
  return (event.id as string) ?? `${event.type}_${Date.now()}`;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
