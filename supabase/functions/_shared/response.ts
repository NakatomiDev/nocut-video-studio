import { corsHeaders } from "./cors.ts";

function meta() {
  return {
    request_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
}

export function successResponse(
  data: unknown,
  status = 200,
): Response {
  return new Response(
    JSON.stringify({ data, meta: meta() }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
  details?: unknown,
): Response {
  const error: Record<string, unknown> = { code, message };
  if (details !== undefined) {
    error.details = details;
  }
  return new Response(
    JSON.stringify({ error, meta: meta() }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
