import { handleCors } from "../_shared/cors.ts";
import { getAuthenticatedUser, AuthError } from "../_shared/auth.ts";
import { successResponse, errorResponse } from "../_shared/response.ts";
import { TOPUP_PRODUCTS } from "../_shared/credits.ts";
import Stripe from "stripe";

// Stripe price IDs — set these in Supabase Dashboard > Edge Functions > Secrets
// or via `supabase secrets set STRIPE_PRICE_nocut_credits_10=price_xxx ...`
const STRIPE_PRICE_IDS: Record<string, string> = {
  nocut_credits_10: Deno.env.get("STRIPE_PRICE_nocut_credits_10") ?? "",
  nocut_credits_30: Deno.env.get("STRIPE_PRICE_nocut_credits_30") ?? "",
  nocut_credits_75: Deno.env.get("STRIPE_PRICE_nocut_credits_75") ?? "",
  nocut_credits_200: Deno.env.get("STRIPE_PRICE_nocut_credits_200") ?? "",
};

const APP_URL = Deno.env.get("APP_URL") ?? "http://localhost:5173";

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
    const product = TOPUP_PRODUCTS[product_id];
    if (!product) {
      return errorResponse(
        "invalid_product",
        `Invalid product_id. Must be one of: ${Object.keys(TOPUP_PRODUCTS).join(", ")}`,
        400,
      );
    }

    const stripePriceId = STRIPE_PRICE_IDS[product_id];
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

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: stripePriceId, quantity: 1 }],
      metadata: {
        user_id: user.id,
        product_id,
        credit_amount: String(product.credits),
      },
      success_url: `${APP_URL}/credits?success=true`,
      cancel_url: `${APP_URL}/credits?cancelled=true`,
    });

    return successResponse({
      checkout_url: session.url,
      session_id: session.id,
      credits: product.credits,
      price: `$${(product.price_cents / 100).toFixed(2)}`,
    });
  } catch (err) {
    console.error("Unhandled error in credits-topup:", err);
    return errorResponse("internal_error", "An unexpected error occurred", 500);
  }
});
