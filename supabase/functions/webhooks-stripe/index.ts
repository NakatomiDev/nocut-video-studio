import { createServiceClient } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import Stripe from "stripe";

// Monthly credit allocation per tier (must match webhooks-revenuecat)
const TIER_CREDITS: Record<string, number> = {
  pro: 40,
  business: 120,
  free: 5,
};

// Product ID → tier mapping (for subscription metadata)
const PRODUCT_TIER_MAP: Record<string, "pro" | "business"> = {
  nocut_pro_monthly: "pro",
  nocut_pro_annual: "pro",
  nocut_business_monthly: "business",
  nocut_business_annual: "business",
};

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  if (!stripeKey || !webhookSecret) {
    console.error("Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET");
    return jsonResponse({ error: "Stripe not configured" }, 500);
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });

  // 1. Read raw body for signature verification
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return jsonResponse({ error: "Missing stripe-signature header" }, 400);
  }

  // 2. Verify webhook signature
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
    );
  } catch (err) {
    console.error("Stripe signature verification failed:", (err as Error).message);
    return jsonResponse({ error: "Invalid signature" }, 400);
  }

  const serviceClient = createServiceClient();

  try {
    console.log(`Stripe event: ${event.type} (${event.id})`);

    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutComplete(serviceClient, event);
        break;

      case "invoice.paid":
        await handleInvoicePaid(serviceClient, stripe, event);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(serviceClient, event);
        break;

      case "charge.refunded":
        await handleChargeRefunded(serviceClient, stripe, event);
        break;

      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }

    // Always return 200 to acknowledge receipt
    return jsonResponse({ ok: true, event_id: event.id });
  } catch (err) {
    console.error("Error processing Stripe webhook:", err);
    // Still return 200 to prevent infinite retries — log for manual investigation
    return jsonResponse({ ok: true, error: "processing_error", event_id: event.id });
  }
});

// ---------------------------------------------------------------------------
// checkout.session.completed
// ---------------------------------------------------------------------------
async function handleCheckoutComplete(
  serviceClient: ReturnType<typeof createServiceClient>,
  event: Stripe.Event,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;

  // Route subscription checkouts to dedicated handler
  if (session.mode === "subscription") {
    await handleSubscriptionCheckout(serviceClient, session);
    return;
  }

  // --- Original top-up checkout logic ---
  const metadata = session.metadata ?? {};

  const userId = metadata.user_id;
  const creditAmount = parseInt(metadata.credit_amount ?? "0", 10);
  const productId = metadata.product_id ?? "unknown";

  if (!userId || creditAmount <= 0) {
    console.error("Checkout session missing user_id or credit_amount in metadata", metadata);
    return;
  }

  // Verify user exists
  const { data: user, error: userError } = await serviceClient
    .from("users")
    .select("id")
    .eq("id", userId)
    .single();

  if (userError || !user) {
    console.error(`User not found for checkout: ${userId}`);
    return;
  }

  // Credits expire in 1 year for top-ups
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const paymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? null;

  // Insert credit_ledger row
  const { data: ledger, error: ledgerError } = await serviceClient
    .from("credit_ledger")
    .insert({
      user_id: userId,
      type: "top_up",
      credits_granted: creditAmount,
      credits_remaining: creditAmount,
      expires_at: expiresAt,
      stripe_payment_id: paymentIntentId,
    })
    .select("id")
    .single();

  if (ledgerError) {
    console.error("Failed to insert credit_ledger for top-up:", ledgerError);
    return;
  }

  // Insert credit_transactions row
  const { error: txError } = await serviceClient
    .from("credit_transactions")
    .insert({
      user_id: userId,
      type: "allocation",
      credits: creditAmount,
      ledger_entries: [{ ledger_id: ledger.id, credits_allocated: creditAmount }],
      reason: `topup_purchase_${productId}`,
    });

  if (txError) {
    console.error("Failed to insert credit_transaction:", txError);
    return;
  }

  console.log(
    `Credited ${creditAmount} top-up credits to user ${userId} ` +
    `(payment_intent: ${paymentIntentId}, session: ${session.id})`,
  );
}

// ---------------------------------------------------------------------------
// Subscription checkout (mode === "subscription")
// ---------------------------------------------------------------------------
async function handleSubscriptionCheckout(
  serviceClient: ReturnType<typeof createServiceClient>,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const metadata = session.metadata ?? {};
  const userId = metadata.user_id;
  const tier = metadata.tier as "pro" | "business" | undefined;
  const productId = metadata.product_id;

  if (!userId || !tier) {
    console.error("Subscription checkout missing user_id or tier in metadata", metadata);
    return;
  }

  // Verify user exists
  const { data: user, error: userError } = await serviceClient
    .from("users")
    .select("id")
    .eq("id", userId)
    .single();

  if (userError || !user) {
    console.error(`User not found for subscription checkout: ${userId}`);
    return;
  }

  // Extract Stripe IDs
  const stripeCustomerId = typeof session.customer === "string"
    ? session.customer
    : (session.customer as any)?.id ?? null;
  const stripeSubscriptionId = typeof session.subscription === "string"
    ? session.subscription
    : (session.subscription as any)?.id ?? null;

  // Update user tier and store Stripe IDs
  const userUpdate: Record<string, unknown> = {
    tier,
    updated_at: new Date().toISOString(),
  };
  if (stripeCustomerId) userUpdate.stripe_customer_id = stripeCustomerId;
  if (stripeSubscriptionId) userUpdate.stripe_subscription_id = stripeSubscriptionId;

  await serviceClient
    .from("users")
    .update(userUpdate)
    .eq("id", userId);

  // Allocate monthly credits
  await allocateMonthlyCredits(serviceClient, userId, tier, `stripe_subscription_${session.id}`);

  console.log(
    `Subscription activated: user ${userId} → ${tier} ` +
    `(customer: ${stripeCustomerId}, subscription: ${stripeSubscriptionId})`,
  );
}

// ---------------------------------------------------------------------------
// invoice.paid (subscription renewals)
// ---------------------------------------------------------------------------
async function handleInvoicePaid(
  serviceClient: ReturnType<typeof createServiceClient>,
  stripe: Stripe,
  event: Stripe.Event,
): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;

  // Only process subscription renewals, not the initial purchase
  if (invoice.billing_reason !== "subscription_cycle") {
    console.log(`Skipping invoice.paid with billing_reason: ${invoice.billing_reason}`);
    return;
  }

  // Get subscription metadata (user_id + tier)
  const subscriptionId = typeof invoice.subscription === "string"
    ? invoice.subscription
    : (invoice.subscription as any)?.id ?? null;

  if (!subscriptionId) {
    console.error("invoice.paid missing subscription ID");
    return;
  }

  // Fetch subscription to get metadata
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const userId = subscription.metadata?.user_id;
  const tier = subscription.metadata?.tier as "pro" | "business" | undefined;

  if (!userId || !tier) {
    console.error("Subscription missing user_id or tier in metadata", subscription.metadata);
    return;
  }

  // Update tier (in case it drifted) and allocate monthly credits
  await serviceClient
    .from("users")
    .update({ tier, updated_at: new Date().toISOString() })
    .eq("id", userId);

  await allocateMonthlyCredits(serviceClient, userId, tier, `stripe_renewal_${invoice.id}`);

  console.log(`Renewal credited: user ${userId} → ${tier} (invoice: ${invoice.id})`);
}

// ---------------------------------------------------------------------------
// customer.subscription.deleted (cancellation / expiration)
// ---------------------------------------------------------------------------
async function handleSubscriptionDeleted(
  serviceClient: ReturnType<typeof createServiceClient>,
  event: Stripe.Event,
): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const userId = subscription.metadata?.user_id;

  if (!userId) {
    console.error("Subscription deleted event missing user_id in metadata", subscription.metadata);
    return;
  }

  // Downgrade to free tier
  await serviceClient
    .from("users")
    .update({
      tier: "free",
      stripe_subscription_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  // Allocate free-tier credits
  await allocateMonthlyCredits(serviceClient, userId, "free", `stripe_expiration_${subscription.id}`);

  console.log(`Subscription ended: user ${userId} downgraded to free (subscription: ${subscription.id})`);
}

// ---------------------------------------------------------------------------
// charge.refunded
// ---------------------------------------------------------------------------
async function handleChargeRefunded(
  serviceClient: ReturnType<typeof createServiceClient>,
  stripe: Stripe,
  event: Stripe.Event,
): Promise<void> {
  const charge = event.data.object as Stripe.Charge;
  const paymentIntentId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : charge.payment_intent?.id ?? null;

  if (!paymentIntentId) {
    console.warn("Charge refund has no payment_intent — skipping");
    return;
  }

  // Find the ledger entry by stripe_payment_id
  const { data: ledgerEntry, error: ledgerError } = await serviceClient
    .from("credit_ledger")
    .select("id, user_id, credits_granted, credits_remaining")
    .eq("stripe_payment_id", paymentIntentId)
    .single();

  if (ledgerError || !ledgerEntry) {
    console.warn(
      `No credit_ledger entry found for payment_intent ${paymentIntentId} — ` +
      `may be a non-credit charge or already processed`,
    );
    return;
  }

  const creditsToRevoke = ledgerEntry.credits_remaining;

  if (creditsToRevoke <= 0) {
    // Credits already fully consumed
    console.warn(
      `Refund for payment_intent ${paymentIntentId}: all ${ledgerEntry.credits_granted} credits ` +
      `already consumed — flagging for manual review`,
    );

    // Log a zero-credit refund transaction for audit trail
    await serviceClient
      .from("credit_transactions")
      .insert({
        user_id: ledgerEntry.user_id,
        type: "refund",
        credits: 0,
        ledger_entries: [{
          ledger_id: ledgerEntry.id,
          credits_revoked: 0,
          note: "credits_already_consumed_manual_review_needed",
        }],
        reason: `stripe_refund_${paymentIntentId}`,
      });
    return;
  }

  // Zero out remaining credits on the ledger entry
  await serviceClient
    .from("credit_ledger")
    .update({ credits_remaining: 0 })
    .eq("id", ledgerEntry.id);

  // Record the refund transaction
  await serviceClient
    .from("credit_transactions")
    .insert({
      user_id: ledgerEntry.user_id,
      type: "refund",
      credits: creditsToRevoke,
      ledger_entries: [{
        ledger_id: ledgerEntry.id,
        credits_revoked: creditsToRevoke,
      }],
      reason: `stripe_refund_${paymentIntentId}`,
    });

  console.log(
    `Revoked ${creditsToRevoke} credits from user ${ledgerEntry.user_id} ` +
    `(refund on payment_intent ${paymentIntentId}, ` +
    `${ledgerEntry.credits_granted - creditsToRevoke} credits were already consumed)`,
  );
}

// ---------------------------------------------------------------------------
// Shared: allocate monthly credits
// ---------------------------------------------------------------------------
async function allocateMonthlyCredits(
  serviceClient: ReturnType<typeof createServiceClient>,
  userId: string,
  tier: string,
  sourceEventId: string,
): Promise<void> {
  const credits = TIER_CREDITS[tier] ?? TIER_CREDITS["free"];
  const expiresAt = new Date(Date.now() + 2 * 30 * 24 * 60 * 60 * 1000).toISOString(); // ~2 months

  const { data: ledger, error: ledgerError } = await serviceClient
    .from("credit_ledger")
    .insert({
      user_id: userId,
      type: "monthly_allowance",
      credits_granted: credits,
      credits_remaining: credits,
      expires_at: expiresAt,
      stripe_payment_id: sourceEventId,
    })
    .select("id")
    .single();

  if (ledgerError) {
    console.error("Failed to insert credit_ledger for subscription:", ledgerError);
    return;
  }

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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
