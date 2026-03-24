import { handleCors } from "../_shared/cors.ts";
import { getAuthenticatedUser, AuthError } from "../_shared/auth.ts";
import { successResponse, errorResponse } from "../_shared/response.ts";
import Stripe from "stripe";

// Subscription product → tier mapping
const PRODUCT_TO_TIER: Record<string, "pro" | "business"> = {
  nocut_pro_monthly: "pro",
  nocut_pro_annual: "pro",
  nocut_business_monthly: "business",
  nocut_business_annual: "business",
};

// Stripe price IDs loaded from env vars
const SUBSCRIPTION_PRICE_IDS: Record<string, string> = {
  nocut_pro_monthly: Deno.env.get("STRIPE_PRICE_PRO_MONTHLY")?.trim() ?? "",
  nocut_pro_annual: Deno.env.get("STRIPE_PRICE_PRO_ANNUAL")?.trim() ?? "",
  nocut_business_monthly: Deno.env.get("STRIPE_PRICE_BUSINESS_MONTHLY")?.trim() ?? "",
  nocut_business_annual: Deno.env.get("STRIPE_PRICE_BUSINESS_ANNUAL")?.trim() ?? "",
};

const APP_URL = Deno.env.get("APP_URL")?.trim() ?? "http://localhost:5173";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "Only POST is allowed", 405);
  }

  try {
    let user;
    try {
      const auth = await getAuthenticatedUser(req);
      user = auth.user;
    } catch (err) {
      if (err instanceof AuthError) {
        return errorResponse("unauthorized", err.message, 401);
      }
      throw err;
    }

    const body = await req.json();
    const { product_id } = body as { product_id: string };

    // Validate product_id
    const tier = PRODUCT_TO_TIER[product_id];
    if (!tier) {
      return errorResponse(
        "invalid_product",
        `Invalid product_id. Must be one of: ${Object.keys(PRODUCT_TO_TIER).join(", ")}`,
        400,
      );
    }

    const stripePriceId = SUBSCRIPTION_PRICE_IDS[product_id];
    if (!stripePriceId) {
      return errorResponse(
        "configuration_error",
        `Stripe price not configured for ${product_id}`,
        500,
      );
    }

    // Initialize Stripe
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return errorResponse("configuration_error", "Stripe is not configured", 500);
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });

    // Create Checkout Session in subscription mode
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: stripePriceId, quantity: 1 }],
      metadata: {
        user_id: user.id,
        product_id,
        tier,
        checkout_type: "subscription",
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          tier,
          product_id,
        },
      },
      customer_email: user.email || undefined,
      success_url: `${APP_URL}/?subscription=success`,
      cancel_url: `${APP_URL}/?subscription=cancelled`,
    });

    return successResponse({
      checkout_url: session.url,
      session_id: session.id,
      tier,
      product_id,
    });
  } catch (err) {
    console.error("Unhandled error in subscribe-checkout:", err);
    return errorResponse("internal_error", "An unexpected error occurred", 500);
  }
});
