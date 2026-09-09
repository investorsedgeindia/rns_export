/**
 * Supabase Edge Function: send-order-email
 * -----------------------------------------
 * Sends an order confirmation email to the customer via Google SMTP (Gmail).
 *
 * Required Environment Secrets (set via Supabase Dashboard > Edge Functions > Secrets):
 *   GMAIL_USER         = your-gmail@gmail.com
 *   GMAIL_APP_PASSWORD = your16charapppassword  (no spaces)
 *   FROM_NAME          = RNS Dryfruits          (optional)
 *
 * Deploy:
 *   supabase functions deploy send-order-email --project-ref lvzmkbgduelpngjnsgdu
 */

import { SmtpClient } from "https://deno.land/x/smtp@v0.7.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function escapeHtml(str: string): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      orderId, orderShortId, customerName, customerEmail,
      items, total, status, createdAt,
    } = await req.json();

    if (!customerEmail || !orderId) {
      return new Response(JSON.stringify({ error: "Missing required fields: customerEmail, orderId" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const gmailUser = Deno.env.get("GMAIL_USER");
    const gmailPass = Deno.env.get("GMAIL_APP_PASSWORD");
    const fromName  = Deno.env.get("FROM_NAME") || "RNS Dryfruits";

    if (!gmailUser || !gmailPass) {
      console.error("GMAIL_USER or GMAIL_APP_PASSWORD secret not set");
      return new Response(JSON.stringify({ error: "SMTP configuration missing on server" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orderDate = createdAt
      ? new Date(createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
      : new Date().toLocaleDateString("en-IN");

    const itemsHtml = (items || "")
      .split("\n")
      .filter(Boolean)
      .map((line: string) => `<li style="padding:6px 0;color:#374151;font-size:14px;">${escapeHtml(line)}</li>`)
      .join("");

    const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><title>Order Confirmed - RNS Dryfruits</title></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:#f9fafb;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0"
      style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:600px;width:100%;">
      <tr>
        <td style="background:linear-gradient(135deg,#92400e 0%,#d97706 50%,#f59e0b 100%);padding:40px 32px;text-align:center;">
          <div style="font-size:52px;margin-bottom:12px;">&#129381;</div>
          <h1 style="margin:0;color:#fff;font-size:28px;font-weight:800;">RNS Dryfruits</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Premium Quality &bull; Freshness Guaranteed</p>
        </td>
      </tr>
      <tr>
        <td style="background:#ecfdf5;padding:24px 32px;border-bottom:1px solid #d1fae5;text-align:center;">
          <div style="font-size:40px;margin-bottom:10px;">&#9989;</div>
          <h2 style="margin:0 0 6px;color:#065f46;font-size:22px;font-weight:700;">Order Confirmed!</h2>
          <p style="margin:0;color:#047857;font-size:15px;">Thank you, <strong>${escapeHtml(customerName)}</strong>! We have received your order.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 32px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:12px;padding:20px;">
            <tr>
              <td style="padding:6px 0;">
                <span style="color:#6b7280;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Order ID</span><br/>
                <span style="color:#111827;font-size:20px;font-weight:800;letter-spacing:1.5px;">#${escapeHtml(orderShortId)}</span>
              </td>
              <td style="padding:6px 0;text-align:right;">
                <span style="color:#6b7280;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Date</span><br/>
                <span style="color:#111827;font-size:15px;font-weight:600;">${escapeHtml(orderDate)}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 32px 0;">
          <h3 style="margin:0 0 14px;color:#111827;font-size:16px;font-weight:700;border-bottom:2px solid #f3f4f6;padding-bottom:10px;">Order Summary</h3>
          <ul style="margin:0 0 8px;padding:0;list-style:none;">${itemsHtml}</ul>
        </td>
      </tr>
      <tr>
        <td style="padding:0 32px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #f3f4f6;padding-top:16px;margin-top:16px;">
            <tr>
              <td style="padding:6px 0;color:#6b7280;font-size:14px;">Subtotal</td>
              <td style="text-align:right;padding:6px 0;color:#374151;font-size:14px;">&#8377;${escapeHtml(String(total))}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#6b7280;font-size:14px;">Shipping</td>
              <td style="text-align:right;padding:6px 0;color:#059669;font-size:14px;font-weight:700;">FREE</td>
            </tr>
            <tr>
              <td style="padding:14px 0 0;color:#111827;font-size:18px;font-weight:800;">Total</td>
              <td style="text-align:right;padding:14px 0 0;color:#d97706;font-size:22px;font-weight:800;">&#8377;${escapeHtml(String(total))}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 32px 32px;">
          <div style="background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:12px;padding:22px;text-align:center;">
            <p style="margin:0 0 6px;color:#92400e;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">&#128230; Order Status</p>
            <p style="margin:0;color:#78350f;font-size:22px;font-weight:800;text-transform:capitalize;">${escapeHtml(status || "Processing")}</p>
            <p style="margin:10px 0 0;color:#92400e;font-size:13px;">We will notify you when your order ships!</p>
          </div>
        </td>
      </tr>
      <tr>
        <td style="background:#f9fafb;padding:24px 32px;text-align:center;border-top:1px solid #e5e7eb;">
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Questions? Contact us at <a href="mailto:hello@rnsdryfruits.com" style="color:#d97706;text-decoration:none;font-weight:600;">hello@rnsdryfruits.com</a></p>
          <p style="margin:0;color:#9ca3af;font-size:12px;">&copy; 2024 RNS Dryfruits. All rights reserved.</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

    // Send via Gmail SMTP TLS (port 465)
    const client = new SmtpClient();
    await client.connectTLS({
      hostname: "smtp.gmail.com",
      port: 465,
      username: gmailUser,
      password: gmailPass,
    });

    await client.send({
      from: `${fromName} <${gmailUser}>`,
      to: customerEmail,
      subject: `Order Confirmed - #${orderShortId} | RNS Dryfruits`,
      content: [
        `Hi ${customerName},`,
        ``,
        `Your order #${orderShortId} has been confirmed!`,
        ``,
        `Items:`,
        items,
        ``,
        `Total: Rs.${total}`,
        ``,
        `We will notify you when your order ships.`,
        ``,
        `Thank you for shopping with RNS Dryfruits!`,
        `- The RNS Dryfruits Team`,
      ].join("\n"),
      html: htmlBody,
    });

    await client.close();

    console.log(`[send-order-email] Sent to ${customerEmail} for order #${orderShortId}`);

    return new Response(
      JSON.stringify({ success: true, message: `Confirmation sent to ${customerEmail}` }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[send-order-email] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
