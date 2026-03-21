import { createClient, SupabaseClient, User } from "@supabase/supabase-js";

export interface AuthResult {
  user: User;
  supabaseClient: SupabaseClient;
}

export async function getAuthenticatedUser(
  req: Request,
): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid Authorization header");
  }

  const token = authHeader.replace("Bearer ", "");

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data, error } = await supabaseClient.auth.getUser(token);
  if (error || !data.user) {
    throw new AuthError(error?.message ?? "Invalid token");
  }

  return { user: data.user, supabaseClient };
}

export function createServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
