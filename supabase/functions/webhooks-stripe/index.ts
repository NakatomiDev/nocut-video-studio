import { createServiceClient } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import Stripe from "stripe";

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
// Helpers
// ---------------------------------------------------------------------------
function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
