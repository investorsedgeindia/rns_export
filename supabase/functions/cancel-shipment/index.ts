/**
 * Supabase Edge Function: cancel-shipment
 * -----------------------------------------
 * Cancels a ShipGlobal order and marks it cancelled in Supabase.
 *
 * POST /functions/v1/cancel-shipment
 * Body:
 *   { "tracking": string }
 *
 * Response:
 *   { success: true, message: string }
 *
 * Required secrets:
 *   SHIPGLOBAL_USERNAME
 *   SHIPGLOBAL_PASSWORD
 */

import {
  callShipGlobal,
  corsHeaders,
  errorResponse,
  getAdminClient,
  jsonResponse,
  parseJsonBody,
} from "../_shared/shipglobal.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface CancelRequest {
  tracking: string;
}

interface CancelResponse {
  success: boolean;
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
    const body = (await parseJsonBody(req)) as unknown as CancelRequest;
    const tracking = String(body.tracking || "").trim();
    if (!tracking) {
      return errorResponse("tracking is required");
    }

    // ── Verify order belongs to this customer ──
    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select("id, customer_id, status, shipglobal_tracking")
      .eq("customer_id", user.id)
      .eq("shipglobal_tracking", tracking)
      .maybeSingle();

    if (orderError) {
      return errorResponse("Could not verify order", 500, orderError);
    }
    if (!order) {
      return errorResponse("Order with this tracking number not found", 404);
    }

    if (order.status === "delivered") {
      return errorResponse("Cannot cancel an order that has already been delivered", 400);
    }

    // ── Call ShipGlobal order/cancelRefundOrder ──
    const { data, error } = await callShipGlobal<CancelResponse>(
      "/order/cancelRefundOrder",
      { tracking }
    );

    if (error) {
      console.error("[cancel-shipment] ShipGlobal error:", error);
      return errorResponse(
        error.message || "Could not cancel shipment with ShipGlobal",
        502,
        { code: error.code }
      );
    }

    const message = data?.msg || data?.message || "Order cancelled successfully";

    // ── Update order status in Supabase using adminClient ──
    const adminClient = getAdminClient();
    const { error: updateError } = await adminClient
      .from("orders")
      .update({
        status: "cancelled",
        progress: 0,
        shipglobal_status: "Cancelled",
        shipglobal_cancelled: true,
        shipglobal_cancelled_at: new Date().toISOString(),
        shipglobal_last_synced_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    if (updateError) {
      console.warn("[cancel-shipment] Failed to update order status:", updateError);
    }

    return jsonResponse({
      success: true,
      message,
    });
  } catch (error) {
    console.error("[cancel-shipment] Error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Unknown error",
      500
    );
  }
});
