/**
 * Supabase Edge Function: track-shipment
 * ---------------------------------------
 * Fetches live tracking data from ShipGlobal via tools/tracking.
 * Also syncs the latest status, status code, and event history
 * back into the Supabase orders table.
 *
 * POST /functions/v1/track-shipment
 * Body:
 *   { "tracking": string }
 *
 * Response:
 *   { success: true, data: { awbEvents: [...], awbInfo: {...} } }
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

interface TrackRequest {
  tracking: string;
}

interface TrackingEvent {
  awb_history_id: string;
  awb_history_datetime: string;
  awb_history_location: string;
  awb_history_comment: string;
  awb_event_code: string;
  type: string;
}

interface TrackingInfo {
  awb_booking_date: string;
  awb_sender_name: string;
  awb_destination: string;
  awb_receiver_name: string;
  awb_number: string;
  partner_lastmile_awb: string;
  awb_postcode: string;
  provider_logo: string;
  partner_lastmile_display: string;
  partner_lastmile_tracking_url: string;
  awb_status: string;
}

interface TrackingResponse {
  success: boolean;
  data?: {
    awbEvents: TrackingEvent[];
    awbInfo: TrackingInfo;
  };
  msg?: string;
  message?: string;
}

const STATUS_PROGRESS: Record<string, number> = {
  SGE_001: 10,
  SGE_101: 15,
  SGE_102: 20,
  SGE_103: 20,
  SGE_104: 25,
  SGE_105: 30,
  SGE_106: 30,
  SGE_107: 35,
  SGE_201: 40,
  SGE_202: 40,
  SGE_203: 45,
  SGE_204: 50,
  SGE_205: 55,
  SGE_206: 60,
  SGE_207: 65,
  SGE_208: 70,
  SGE_301: 75,
  SGE_302: 80,
  SGE_303: 90,
  SGE_304: 100,
  SGE_305: 75,
  SGE_401: 40,
  SGE_402: 40,
  SGE_403: 40,
  SGE_501: 90,
  SGE_502: 90,
  SGE_503: 40,
  SGE_504: 40,
  SGE_505: 40,
  SGE_506: 40,
  SGERROR_101: 40,
  SGERROR_102: 40,
  SGERROR_103: 40,
  SGERROR_104: 40,
};

function normalizeStatus(status: string): string {
  const s = String(status || "").trim().toLowerCase();
  if (s.includes("deliver")) return "delivered";
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("transit") || s.includes("picked") || s.includes("received") || s.includes("cleared") || s.includes("departed") || s.includes("arrived") || s.includes("processing") || s.includes("awaiting") || s.includes("out for")) {
    return "shipped";
  }
  return "processing";
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
    const body = (await parseJsonBody(req)) as unknown as TrackRequest;
    const tracking = String(body.tracking || "").trim();
    if (!tracking) {
      return errorResponse("tracking is required");
    }

    // ── Verify the tracking number belongs to this user's order ──
    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select("id, customer_id")
      .eq("customer_id", user.id)
      .eq("shipglobal_tracking", tracking)
      .maybeSingle();

    if (orderError) {
      return errorResponse("Could not verify order", 500, orderError);
    }
    if (!order) {
      return errorResponse("Tracking number not found for this customer", 404);
    }

    // ── Call ShipGlobal tools/tracking ──
    const { data, error } = await callShipGlobal<TrackingResponse>("/tools/tracking", {
      tracking,
    });

    if (error) {
      console.error("[track-shipment] ShipGlobal error:", error);
      return errorResponse(
        error.message || "Could not fetch tracking from ShipGlobal",
        502,
        { code: error.code }
      );
    }

    if (!data || !data.success || !data.data) {
      return errorResponse("ShipGlobal returned no tracking data", 502);
    }

    const awbInfo = data.data.awbInfo || {};
    const awbEvents = Array.isArray(data.data.awbEvents) ? data.data.awbEvents : [];
    const latestEvent = awbEvents[0];
    const statusCode =
      latestEvent?.awb_event_code ||
      (awbInfo.awb_status ? "" : "");
    const rawStatus = awbInfo.awb_status || latestEvent?.awb_history_comment || "";
    const status = normalizeStatus(rawStatus);
    const progress = statusCode && STATUS_PROGRESS[statusCode] !== undefined
      ? STATUS_PROGRESS[statusCode]
      : status === "delivered" ? 100 : status === "cancelled" ? 0 : 33;

    // ── Sync tracking data back into Supabase ──
    const { error: updateError } = await supabaseClient
      .from("orders")
      .update({
        shipglobal_status: rawStatus || "Unknown",
        shipglobal_status_code: statusCode || null,
        shipglobal_events: awbEvents,
        shipglobal_last_synced_at: new Date().toISOString(),
        status,
        progress,
      })
      .eq("id", order.id);

    if (updateError) {
      console.warn("[track-shipment] Failed to sync tracking:", updateError);
    }

    return jsonResponse({
      success: true,
      data: {
        ...data.data,
        awbEvents,
        awbInfo,
        status,
        progress,
      },
      message: data.msg || data.message,
    });
  } catch (error) {
    console.error("[track-shipment] Error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Unknown error",
      500
    );
  }
});
