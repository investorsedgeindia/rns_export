/**
 * Supabase Edge Function: get-shipping-rates
 * -------------------------------------------
 * Calls ShipGlobal Rate Calculator API to get international shipping quotes.
 *
 * POST /functions/v1/get-shipping-rates
 * Body:
 *   {
 *     "package_weight": number (kg),
 *     "country_iso_code_2": string (ISO 2-letter),
 *     "postcode": string
 *   }
 *
 * Response:
 *   { success: true, billed_weight, billed_weight_unit, currency, services: [...] }
 *
 * Required secrets (set in Supabase Dashboard > Edge Functions > Secrets):
 *   SHIPGLOBAL_USERNAME
 *   SHIPGLOBAL_PASSWORD
 */

import {
  callShipGlobal,
  corsHeaders,
  errorResponse,
  jsonResponse,
  parseJsonBody,
} from "../_shared/shipglobal.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface RateRequest {
  package_weight: number;
  country_iso_code_2: string;
  postcode: string;
}

interface RateService {
  title: string;
  notes: string;
  transit_time: string;
  price: { logistic_fee: number };
  subtotal_fee: number;
}

interface RateResponse {
  success: boolean;
  billed_weight: number;
  billed_weight_unit: string;
  currency: string;
  services: RateService[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    // ── Verify the user is authenticated ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse("Missing Authorization header", 401);
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return errorResponse("Unauthorized", 401);
    }

    // ── Validate request body ──
    const body = (await parseJsonBody(req)) as unknown as RateRequest;
    const packageWeight = Number(body.package_weight);
    const countryCode = String(body.country_iso_code_2 || "").trim().toUpperCase();
    const postcode = String(body.postcode || "").trim();

    if (
      !Number.isFinite(packageWeight) ||
      packageWeight <= 0 ||
      packageWeight > 1000
    ) {
      return errorResponse("package_weight must be a number greater than 0 and at most 1000 kg");
    }

    if (!/^[A-Z]{2}$/.test(countryCode)) {
      return errorResponse("country_iso_code_2 must be a 2-letter ISO country code (e.g. GB, US, IN)");
    }

    if (!postcode) {
      return errorResponse("postcode is required");
    }

    // ── Call ShipGlobal Rate Calculator ──
    const { data, error } = await callShipGlobal<RateResponse>("/rates/calculate", {
      package_weight: String(packageWeight),
      country_iso_code_2: countryCode,
      postcode,
    });

    if (error) {
      console.error("[get-shipping-rates] ShipGlobal error:", error);
      return errorResponse(
        error.message || "Could not get shipping rates from ShipGlobal",
        502,
        { code: error.code }
      );
    }

    if (!data || !data.success) {
      return errorResponse("ShipGlobal returned an empty or unsuccessful response", 502);
    }

    // ── Cache the quote in Supabase for checkout reuse (TTL 15 minutes) ──
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { error: cacheError } = await supabaseClient.from("shipping_quotes").insert({
      customer_id: user.id,
      country_iso2: countryCode,
      postcode,
      package_weight: packageWeight,
      currency: data.currency || "INR",
      services: data.services,
      expires_at: expiresAt,
    });

    if (cacheError) {
      console.warn("[get-shipping-rates] Failed to cache quote:", cacheError);
    }

    return jsonResponse({
      success: true,
      ...data,
      quote_expires_at: expiresAt,
    });
  } catch (error) {
    console.error("[get-shipping-rates] Error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Unknown error",
      500
    );
  }
});
