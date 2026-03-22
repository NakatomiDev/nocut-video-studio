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

   const token = authHeader.replace("Bearer ", "").trim();
   if (!token) {
     throw new AuthError("Missing bearer token");
   }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data, error } = await supabaseClient.auth.getClaims(token);
  const claims = data?.claims;

  if (error || !claims?.sub) {
    throw new AuthError(error?.message ?? "Invalid token");
  }

  return {
    user: {
      id: claims.sub,
      email: typeof claims.email === "string" ? claims.email : "",
      role: typeof claims.role === "string" ? claims.role : "authenticated",
      aud: typeof claims.aud === "string" ? claims.aud : "authenticated",
      app_metadata: typeof claims.app_metadata === "object" && claims.app_metadata !== null
        ? claims.app_metadata as User["app_metadata"]
        : {},
      user_metadata: typeof claims.user_metadata === "object" && claims.user_metadata !== null
        ? claims.user_metadata as User["user_metadata"]
        : {},
      created_at: new Date(0).toISOString(),
    } as User,
    supabaseClient,
  };
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
