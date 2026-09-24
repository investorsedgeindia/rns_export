/**
 * Supabase Edge Function: get-shipping-label
 * -------------------------------------------
 * Fetches the shipping label PDF from ShipGlobal via order/getLabel.
 *
 * POST /functions/v1/get-shipping-label
 * Body:
 *   { "tracking": string, "label": true }
 *
 * Response:
 *   { success: true, tracking, label: "<base64 PDF>" }
 *
 * Required secrets:
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

interface GetLabelRequest {
  tracking: string;
  label: boolean;
}

interface GetLabelResponse {
  success: boolean;
  tracking?: string;
  label?: string;
  msg?: string;
  message?: string;
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
    const body = (await parseJsonBody(req)) as unknown as GetLabelRequest;
    const tracking = String(body.tracking || "").trim();
    if (!tracking) {
      return errorResponse("tracking is required");
    }

    // ── Verify the tracking number belongs to this user's order ──
    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select("id, shipglobal_tracking")
      .eq("customer_id", user.id)
      .eq("shipglobal_tracking", tracking)
      .maybeSingle();

    if (orderError) {
      return errorResponse("Could not verify order", 500, orderError);
    }
    if (!order) {
      return errorResponse("Tracking number not found for this customer", 404);
    }

    // ── Call ShipGlobal order/getLabel ──
    const { data, error } = await callShipGlobal<GetLabelResponse>("/order/getLabel", {
      tracking,
      label: true,
    });

    if (error) {
      console.error("[get-shipping-label] ShipGlobal error:", error);
      return errorResponse(
        error.message || "Could not fetch shipping label from ShipGlobal",
        502,
        { code: error.code }
      );
    }

    if (!data || !data.success || !data.label) {
      return errorResponse("ShipGlobal did not return a shipping label", 502);
    }

    // ── Store the label reference on the order ──
    const { error: updateError } = await supabaseClient
      .from("orders")
      .update({ shipglobal_label: data.label })
      .eq("id", order.id);

    if (updateError) {
      console.warn("[get-shipping-label] Failed to store label:", updateError);
    }

    return jsonResponse({
      success: true,
      tracking: data.tracking || tracking,
      label: data.label,
      message: data.msg || data.message || "Label fetched successfully",
    });
  } catch (error) {
    console.error("[get-shipping-label] Error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Unknown error",
      500
    );
  }
});
