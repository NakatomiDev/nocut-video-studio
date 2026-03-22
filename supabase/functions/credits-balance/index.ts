import { handleCors } from "../_shared/cors.ts";
import { getAuthenticatedUser, AuthError } from "../_shared/auth.ts";
import { successResponse, errorResponse } from "../_shared/response.ts";
import { getCreditBalance } from "../_shared/credits.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "GET") {
    return errorResponse("method_not_allowed", "Only GET is allowed", 405);
  }

  try {
    let user, supabaseClient;
    try {
      const auth = await getAuthenticatedUser(req);
      user = auth.user;
      supabaseClient = auth.supabaseClient;
    } catch (err) {
      if (err instanceof AuthError) {
        return errorResponse("unauthorized", err.message, 401);
      }
      throw err;
    }

    const balance = await getCreditBalance(supabaseClient, user.id);

    return successResponse({
      balance: {
        monthly: balance.monthly,
        topup: balance.topup,
        total: balance.total,
      },
      breakdown: balance.breakdown,
    });
  } catch (err) {
    console.error("Unhandled error in credits-balance:", err);
    return errorResponse("internal_error", "An unexpected error occurred", 500);
  }
});
