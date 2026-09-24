// ShipGlobal API helper for Supabase Edge Functions.
// All ShipGlobal credentials must be stored as Edge Function secrets
// (Supabase Dashboard > Edge Functions > [function] > Secrets),
// never in frontend code or this repository.
//
// Required secrets:
//   SHIPGLOBAL_USERNAME  = your ShipGlobal vendor email / username
//   SHIPGLOBAL_PASSWORD  = your ShipGlobal vendor password / API key
//
// Optional:
//   SHIPGLOBAL_BASE_URL  = https://app.shipglobal.in (default)

export const SHIPGLOBAL_BASE_URL =
  Deno.env.get("SHIPGLOBAL_BASE_URL") ?? "https://app.shipglobal.in";

export const SHIPGLOBAL_API_PATH = "/apiv1";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export interface ShipGlobalErrorResponse {
  success?: boolean;
  error?: string;
  message?: string;
  msg?: string;
  code?: string | number;
}

export function shipGlobalAuthHeaders(): Record<string, string> {
  const username = Deno.env.get("SHIPGLOBAL_USERNAME");
  const password = Deno.env.get("SHIPGLOBAL_PASSWORD");

  if (!username || !password) {
    throw new Error(
      "ShipGlobal credentials are not configured. Set SHIPGLOBAL_USERNAME and SHIPGLOBAL_PASSWORD secrets."
    );
  }

  const token = btoa(`${username}:${password}`);
  return {
    Authorization: `Basic ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export async function callShipGlobal<T>(
  path: string,
  payload: unknown
): Promise<{ data: T; error?: ShipGlobalErrorResponse }> {
  const url = `${SHIPGLOBAL_BASE_URL}${SHIPGLOBAL_API_PATH}${path}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: shipGlobalAuthHeaders(),
      body: JSON.stringify(payload),
    });

    const body = (await response.json()) as T & ShipGlobalErrorResponse;

    if (!response.ok) {
      return {
        data: body as T,
        error: {
          code: response.status,
          message:
            (body as ShipGlobalErrorResponse).message ||
            (body as ShipGlobalErrorResponse).msg ||
            `ShipGlobal API returned HTTP ${response.status}`,
        },
      };
    }

    return { data: body as T };
  } catch (error) {
    return {
      data: undefined as T,
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
      },
    };
  }
}

export function jsonResponse(
  body: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function errorResponse(
  message: string,
  status = 400,
  details?: unknown
): Response {
  return jsonResponse(
    { error: message, ...(details ? { details } : {}) },
    status
  );
}

export function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  return req.json() as Promise<Record<string, unknown>>;
}
