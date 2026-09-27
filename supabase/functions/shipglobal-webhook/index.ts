import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function verifyWebhookSecret(supabase: any, req: Request): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'SHIPGLOBAL_WEBHOOK_SECRET')
      .single()
    
    const secret = data?.value
    if (!secret) return true // No secret configured, allow all
    
    // Check header (ShipGlobal may send in different headers)
    const providedSecret = req.headers.get('x-webhook-secret') || 
                           req.headers.get('x-shipglobal-secret') || 
                           req.headers.get('authorization')?.replace('Bearer ', '')
    
    return providedSecret === secret
  } catch {
    return true // If verification fails, allow (fail open for now)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing Supabase configuration')
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // Verify webhook secret if configured
    const isValid = await verifyWebhookSecret(supabase, req)
    if (!isValid) {
      console.warn('[ShipGlobal Webhook] Invalid webhook secret')
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      })
    }

    const payload = await req.json()
    console.log('[ShipGlobal Webhook] Received:', JSON.stringify(payload, null, 2))

    // Extract tracking number from various possible ShipGlobal webhook formats
    const awb = payload.awb_number || payload.tracking_number || payload.tracking || payload.awb
    const status = payload.awb_status || payload.status || payload.current_status
    const events = payload.awb_events || payload.events || payload.tracking_events || []
    const carrier = payload.carrier || payload.partner_name || payload.shipping_partner
    const label = payload.label || payload.shipping_label || null

    if (!awb) {
      console.warn('[ShipGlobal Webhook] No tracking number in payload')
      return new Response(JSON.stringify({ error: 'No tracking number provided' }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      })
    }

    // Use service role key to bypass RLS
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing Supabase configuration')
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // Map ShipGlobal status to local status enum
    const newStatus = mapShipGlobalStatus(status)
    const progress = calculateProgressFromStatus(newStatus, status)

    console.log(`[ShipGlobal Webhook] Updating order with AWB ${awb} to status: ${newStatus} (${progress}%)`)

    // Update order in database
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        status: newStatus,
        progress,
        shipglobal_status: status || null,
        shipglobal_status_code: payload.awb_status_code || payload.status_code || null,
        shipglobal_events: events,
        shipglobal_last_synced_at: new Date().toISOString(),
        shipglobal_service: carrier || null,
        shipglobal_label: label,
        updated_at: new Date().toISOString(),
      })
      .eq('shipglobal_tracking', awb)
      .select('id, customer_id, total, status')
      .single()

    if (updateError) {
      // Order not found with this tracking - might be a new shipment
      console.warn('[ShipGlobal Webhook] Order not found for AWB:', awb, updateError)
      
      // Try finding by order reference if available
      const orderRef = payload.order_reference || payload.merchant_order_id || payload.reference_id
      if (orderRef) {
        const { error: refError } = await supabase
          .from('orders')
          .update({
            status: newStatus,
            progress,
            shipglobal_status: status || null,
            shipglobal_status_code: payload.awb_status_code || payload.status_code || null,
            shipglobal_events: events,
            shipglobal_last_synced_at: new Date().toISOString(),
            shipglobal_service: carrier || null,
            shipglobal_label: label,
            shipglobal_tracking: awb,
            shipglobal_order_reference: orderRef,
            updated_at: new Date().toISOString(),
          })
          .eq('id', orderRef)
        
        if (refError) {
          throw new Error(`Order not found for AWB ${awb} or reference ${orderRef}`)
        }
        console.log('[ShipGlobal Webhook] Updated via order reference:', orderRef)
      } else {
        throw new Error(`Order not found for AWB ${awb}`)
      }
    } else {
      console.log('[ShipGlobal Webhook] Order updated:', updatedOrder?.id)
    }

    // If delivered, optionally trigger delivery confirmation email
    if (newStatus === 'delivered' && updatedOrder) {
      try {
        await supabase.functions.invoke('send-order-email', {
          body: {
            type: 'delivery_confirmation',
            orderId: updatedOrder.id,
            customerId: updatedOrder.customer_id,
            tracking: awb,
          }
        })
      } catch (emailErr) {
        console.warn('[ShipGlobal Webhook] Delivery email failed (non-critical):', emailErr)
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      message: `Order status updated to ${newStatus}`,
      orderId: updatedOrder?.id 
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })

  } catch (err) {
    console.error('[ShipGlobal Webhook Error]', err)
    return new Response(JSON.stringify({ 
      error: err.message,
      success: false 
    }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })
  }
})

function mapShipGlobalStatus(rawStatus: string | null | undefined): string {
  if (!rawStatus) return 'processing'
  const status = rawStatus.toLowerCase()
  
  // Delivered states
  if (status.includes('delivered') || status.includes('deliverd') || 
      status.includes('completed') || status.includes('successful delivery') ||
      status.includes('proof of delivery') || status.includes('pod')) {
    return 'delivered'
  }
  
  // Shipped/In transit states
  if (status.includes('shipped') || status.includes('in transit') || 
      status.includes('dispatched') || status.includes('out for delivery') ||
      status.includes('pickup') || status.includes('picked up') ||
      status.includes('on the way') || status.includes('transit') ||
      status.includes('en route') || status.includes('departed') ||
      status.includes('arrived at') || status.includes('sorting') ||
      status.includes('customs cleared') || status.includes('cleared customs')) {
    return 'shipped'
  }
  
  // Exception/Issue states (treat as shipped but flagged)
  if (status.includes('exception') || status.includes('delay') || 
      status.includes('attempted') || status.includes('failed delivery') ||
      status.includes('address issue') || status.includes('hold')) {
    return 'shipped'
  }
  
  // Cancelled/Returned/Refunded
  if (status.includes('cancel') || status.includes('return') || 
      status.includes('refund') || status.includes('rejected') ||
      status.includes('void') || status.includes('abandoned')) {
    return 'cancelled'
  }
  
  // Label created / Processing
  if (status.includes('label') || status.includes('created') || 
      status.includes('pending') || status.includes('booking') ||
      status.includes('manifested') || status.includes('ready to ship') ||
      status.includes('awaiting pickup') || status.includes('registered')) {
    return 'processing'
  }
  
  // Default to processing for unknown statuses
  console.warn('[ShipGlobal Webhook] Unknown status, defaulting to processing:', rawStatus)
  return 'processing'
}

function calculateProgressFromStatus(mappedStatus: string, rawStatus: string | null | undefined): number {
  switch (mappedStatus) {
    case 'delivered': return 100
    case 'shipped': return 75
    case 'cancelled': return 0
    case 'processing':
    default:
      if (rawStatus) {
        const lower = rawStatus.toLowerCase()
        if (lower.includes('label')) return 50
        if (lower.includes('pickup') || lower.includes('picked up')) return 40
        if (lower.includes('manifested') || lower.includes('booking')) return 35
        if (lower.includes('registered') || lower.includes('created')) return 25
      }
      return 33
  }
}