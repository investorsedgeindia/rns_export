/**
 * Supabase Edge Function: create-shipment
 * ----------------------------------------
 * Creates a ShipGlobal order/shipment via the order/add API.
 *
 * POST /functions/v1/create-shipment
 * Body:
 *   {
 *     "orderId": string (Supabase order id),
 *     "service": string (selected ShipGlobal service title),
 *     "customer": { firstname, lastname, mobile, email, company, address, address2, address3, city, postcode, country, state },
 *     "package": { weight, length, breadth, height },
 *     "currency": string (default USD),
 *     "items": [{ name, quantity, unit_price, hsn, tax_rate, sku }]
 *   }
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

interface CreateShipmentRequest {
  orderId: string;
  service: string;
  currency: string;
  customer: {
    firstname: string;
    lastname: string;
    mobile: string;
    email: string;
    company?: string;
    address: string;
    address2?: string;
    address3?: string;
    city: string;
    postcode: string;
    country: string;
    state: string;
  };
  package: {
    weight: number;
    length: number;
    breadth: number;
    height: number;
  };
  items: Array<{
    name: string;
    quantity: string | number;
    unit_price: string | number;
    hsn: string;
    tax_rate: string | number;
    sku?: string;
  }>;
}

interface CreateShipmentResponse {
  success: boolean;
  tracking?: string;
  awb?: string;
  msg?: string;
  message?: string;
}

function sanitize(str: unknown, fallback = "", max = 200): string {
  if (str == null) return fallback;
  return String(str).trim().slice(0, max);
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

    // ── Validate and read request body ──
    const body = (await parseJsonBody(req)) as unknown as CreateShipmentRequest;
    const orderId = sanitize(body.orderId);
    if (!orderId) {
      return errorResponse("orderId is required");
    }

    // ── Load the order from Supabase and verify ownership ──
    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select("id, customer_id, items, total, subtotal, shipping_country, shipping_postcode, shipping_service, shipping_cost")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError) {
      return errorResponse("Could not load order", 500, orderError);
    }
    if (!order) {
      return errorResponse("Order not found", 404);
    }
    if (order.customer_id !== user.id) {
      return errorResponse("You can only create shipments for your own orders", 403);
    }

    const customer = body.customer;
    if (!customer || !customer.firstname || !customer.lastname || !customer.email) {
      return errorResponse("customer.firstname, customer.lastname and customer.email are required");
    }

    const countryCode = sanitize(customer.country).toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode)) {
      return errorResponse("customer.country must be a 2-letter ISO code");
    }

    const packageInfo = body.package;
    if (!packageInfo || packageInfo.weight <= 0) {
      return errorResponse("package.weight must be greater than 0");
    }

    const items = (body.items || []).map((item) => ({
      vendor_order_item_name: sanitize(item.name, "Item", 100),
      vendor_order_item_sku: sanitize(item.sku, "", 50),
      vendor_order_item_quantity: String(item.quantity || 1),
      vendor_order_item_unit_price: String(item.unit_price || 0),
      vendor_order_item_hsn: sanitize(item.hsn, "000000", 20),
      vendor_order_item_tax_rate: String(item.tax_rate || 0),
    }));

    if (items.length === 0) {
      return errorResponse("At least one order item is required");
    }

    const invoiceNo = `INV-${orderId.slice(0, 8).toUpperCase()}`;
    const orderReference = `RNS-${orderId.slice(0, 8).toUpperCase()}`;
    const service = sanitize(body.service, "Shipglobal Direct", 100);
    const currency = sanitize(body.currency, "USD", 3).toUpperCase();
    const csb5Status = Number(Deno.env.get("SHIPGLOBAL_CSB5_STATUS") ?? 1);

    // ── Build the ShipGlobal order/add payload ──
    const shipGlobalPayload = {
      invoice_no: invoiceNo,
      invoice_date: new Date().toISOString().slice(0, 10),
      order_reference: orderReference,
      service,
      package_weight: String(packageInfo.weight),
      package_length: String(packageInfo.length || 10),
      package_breadth: String(packageInfo.breadth || 10),
      package_height: String(packageInfo.height || 10),
      currency_code: currency,
      csb5_status: csb5Status,
      customer_shipping_firstname: sanitize(customer.firstname, "", 100),
      customer_shipping_lastname: sanitize(customer.lastname, "", 100),
      customer_shipping_mobile: sanitize(customer.mobile, "", 30),
      customer_shipping_email: sanitize(customer.email, "", 254),
      customer_shipping_company: sanitize(customer.company, "", 100),
      customer_shipping_address: sanitize(customer.address, "", 200),
      customer_shipping_address_2: sanitize(customer.address2, "", 200),
      customer_shipping_address_3: sanitize(customer.address3, "", 200),
      customer_shipping_city: sanitize(customer.city, "", 100),
      customer_shipping_postcode: sanitize(customer.postcode, "", 20),
      customer_shipping_country_code: countryCode,
      customer_shipping_state: sanitize(customer.state, "", 100),
      ioss_number: "",
      customer_nickname: "",
      vendor_order_items: items,
    };

    // ── Call ShipGlobal order/add ──
    const { data, error } = await callShipGlobal<CreateShipmentResponse>(
      "/order/add",
      shipGlobalPayload
    );

    if (error) {
      console.error("[create-shipment] ShipGlobal error:", error);
      return errorResponse(
        error.message || "Could not create shipment with ShipGlobal",
        502,
        { code: error.code }
      );
    }

    if (!data || !data.success) {
      return errorResponse("ShipGlobal returned an unsuccessful response", 502);
    }

    const tracking = data.tracking || data.awb || "";
    if (!tracking) {
      return errorResponse("ShipGlobal did not return a tracking number", 502);
    }

    // ── Update the Supabase order with ShipGlobal references using adminClient to ensure RLS compliance ──
    const adminClient = getAdminClient();
    const { error: updateError } = await adminClient
      .from("orders")
      .update({
        shipglobal_invoice_no: invoiceNo,
        shipglobal_order_reference: orderReference,
        shipglobal_tracking: tracking,
        shipglobal_service: service,
        shipglobal_status: "Created",
        shipglobal_created: true,
        shipglobal_last_synced_at: new Date().toISOString(),
        shipping_country: countryCode,
        shipping_postcode: sanitize(customer.postcode, "", 20),
        shipping_service: service,
        shipping_cost: order.shipping_cost,
        shipping_currency: currency,
      })
      .eq("id", orderId);

    if (updateError) {
      console.error("[create-shipment] Failed to update order:", updateError);
    }

    return jsonResponse({
      success: true,
      tracking,
      invoice_no: invoiceNo,
      order_reference: orderReference,
      message: data.msg || data.message || "Shipment created successfully",
    });
  } catch (error) {
    console.error("[create-shipment] Error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Unknown error",
      500
    );
  }
});
