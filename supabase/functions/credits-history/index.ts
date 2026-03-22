import { handleCors } from "../_shared/cors.ts";
import { getAuthenticatedUser, AuthError } from "../_shared/auth.ts";
import { successResponse, errorResponse } from "../_shared/response.ts";

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

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 100);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

    // Get total count
    const { count, error: countError } = await supabaseClient
      .from("credit_transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    if (countError) throw countError;

    // Get paginated transactions with project title
    const { data: transactions, error } = await supabaseClient
      .from("credit_transactions")
      .select("id, type, credits, reason, created_at, ledger_entries, project_id, projects(title)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const items = (transactions ?? []).map((tx: Record<string, unknown>) => ({
      id: tx.id,
      type: tx.type,
      credits: tx.credits,
      reason: tx.reason,
      project_title: (tx.projects as { title: string } | null)?.title ?? null,
      project_id: tx.project_id,
      ledger_entries: tx.ledger_entries,
      created_at: tx.created_at,
    }));

    return successResponse({
      transactions: items,
      total_count: count ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error("Unhandled error in credits-history:", err);
    return errorResponse("internal_error", "An unexpected error occurred", 500);
  }
});
