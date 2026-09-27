import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY')
    const shipglobalUsername = Deno.env.get('SHIPGLOBAL_USERNAME')
    const shipglobalPassword = Deno.env.get('SHIPGLOBAL_PASSWORD')
    const shipglobalBaseUrl = Deno.env.get('SHIPGLOBAL_BASE_URL') || 'https://app.shipglobal.in'

    if (!supabaseUrl || !serviceRoleKey || !shipglobalUsername || !shipglobalPassword) {
      throw new Error('Missing required environment variables')
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // Get all orders that need syncing:
    // - Have tracking number
    // - Not delivered or cancelled
    // - Last synced > 30 minutes ago (or never synced)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()

    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, shipglobal_tracking, shipglobal_last_synced_at, status, shipglobal_cancelled')
      .not('shipglobal_tracking', 'is', null)
      .neq('status', 'delivered')
      .or(`shipglobal_cancelled.is.null,shipglobal_cancelled.eq.false`)
      .or(`shipglobal_last_synced_at.is.null,shipglobal_last_synced_at.lt.${thirtyMinutesAgo}`)
      .order('created_at', { ascending: false })
      .limit(50) // Process in batches

    if (error) throw error

    console.log(`[Sync All] Found ${orders?.length || 0} orders to sync`)

    const results = []
    const shipglobalAuth = btoa(`${shipglobalUsername}:${shipglobalPassword}`)

    for (const order of orders || []) {
      const tracking = order.shipglobal_tracking
      try {
        // Call ShipGlobal tracking API directly
        const response = await fetch(`${shipglobalBaseUrl}/apiv1/track?awb=${tracking}`, {
          headers: {
            'Authorization': `Basic ${shipglobalAuth}`,
            'Accept': 'application/json',
          }
        })

        if (!response.ok) {
          const errText = await response.text()
          throw new Error(`ShipGlobal API ${response.status}: ${errText}`)
        }

        const result = await response.json()
        const awbInfo = result.data?.awbInfo || result.awbInfo || {}
        const events = Array.isArray(result.data?.awbEvents) ? result.data.awbEvents : 
                       Array.isArray(result.awbEvents) ? result.awbEvents : []

        const newStatus = mapShipGlobalStatus(awbInfo.awb_status)
        const progress = calculateProgressFromStatus(newStatus, awbInfo.awb_status)

        // Update order
        const { error: updateError } = await supabase
          .from('orders')
          .update({
            status: newStatus,
            progress,
            shipglobal_status: awbInfo.awb_status || null,
            shipglobal_status_code: awbInfo.awb_status_code || null,
            shipglobal_events: events,
            shipglobal_last_synced_at: new Date().toISOString(),
            shipglobal_service: awbInfo.partner_name || awbInfo.carrier || null,
            shipglobal_label: result.data?.label || result.label || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', order.id)

        if (updateError) throw updateError

        results.push({ orderId: order.id, tracking, status: newStatus, success: true })
        console.log(`[Sync All] Synced ${order.id.slice(0,8)}: ${newStatus}`)

      } catch (err) {
        console.error(`[Sync All] Failed for ${order.id.slice(0,8)} (${tracking}):`, err)
        results.push({ orderId: order.id, tracking, success: false, error: err.message })
      }
    }

    const successCount = results.filter(r => r.success).length
    const failCount = results.filter(r => !r.success).length

    return new Response(JSON.stringify({ 
      success: true,
      synced: successCount,
      failed: failCount,
      results 
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })

  } catch (err) {
    console.error('[Sync All Error]', err)
    return new Response(JSON.stringify({ 
      success: false,
      error: err.message 
    }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })
  }
})

function mapShipGlobalStatus(rawStatus: string | null | undefined): string {
  if (!rawStatus) return 'processing'
  const status = rawStatus.toLowerCase()
  
  if (status.includes('delivered') || status.includes('deliverd') || 
      status.includes('completed') || status.includes('successful delivery') ||
      status.includes('proof of delivery') || status.includes('pod')) {
    return 'delivered'
  }
  
  if (status.includes('shipped') || status.includes('in transit') || 
      status.includes('dispatched') || status.includes('out for delivery') ||
      status.includes('pickup') || status.includes('picked up') ||
      status.includes('on the way') || status.includes('transit') ||
      status.includes('en route') || status.includes('departed') ||
      status.includes('arrived at') || status.includes('sorting') ||
      status.includes('customs cleared') || status.includes('cleared customs')) {
    return 'shipped'
  }
  
  if (status.includes('exception') || status.includes('delay') || 
      status.includes('attempted') || status.includes('failed delivery') ||
      status.includes('address issue') || status.includes('hold')) {
    return 'shipped'
  }
  
  if (status.includes('cancel') || status.includes('return') || 
      status.includes('refund') || status.includes('rejected') ||
      status.includes('void') || status.includes('abandoned')) {
    return 'cancelled'
  }
  
  if (status.includes('label') || status.includes('created') || 
      status.includes('pending') || status.includes('booking') ||
      status.includes('manifested') || status.includes('ready to ship') ||
      status.includes('awaiting pickup') || status.includes('registered')) {
    return 'processing'
  }
  
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