import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiSuccess, apiError, getBearerToken } from '@/lib/api'
import { submitOrder } from '@/lib/broker-router'
import type { Order } from '@/lib/types'

async function getUserId(req: NextRequest): Promise<string | null> {
  const token = getBearerToken(req)
  if (!token) return null
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data: { user } } = await supabase.auth.getUser(token)
  return user?.id ?? null
}

export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return apiError('Unauthorized', 401)

  const status = req.nextUrl.searchParams.get('status')
  const supabase = createAdminClient()

  let query = supabase
    .from('orders')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return apiError(error.message, 500)
  return apiSuccess(data ?? [], { count: data?.length ?? 0 })
}

export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return apiError('Unauthorized', 401)

  const body = await req.json().catch(() => ({}))
  const {
    symbol, asset_class, side, order_type = 'market',
    notional_usd, quantity, limit_price, stop_price,
    trail_amount, trail_percent, time_in_force = 'day',
    source, source_ref_id, broker_override,
  } = body

  if (!symbol || !asset_class || !side) {
    return apiError('symbol, asset_class, and side are required', 400)
  }

  if (!notional_usd && !quantity) {
    return apiError('Either notional_usd or quantity is required', 400)
  }

  const supabase = createAdminClient()

  // Create order record
  const { data: order, error: insertErr } = await supabase
    .from('orders')
    .insert({
      user_id: userId,
      symbol,
      asset_class,
      side,
      order_type,
      notional_usd,
      quantity,
      limit_price,
      stop_price,
      trail_amount,
      trail_percent,
      time_in_force,
      source: source ?? 'manual',
      source_ref_id,
      status: 'pending',
    })
    .select()
    .single()

  if (insertErr || !order) return apiError(insertErr?.message ?? 'Insert failed', 500)

  // Submit to broker
  const result = await submitOrder({
    symbol, asset_class, side, order_type,
    notional_usd, quantity, limit_price, stop_price,
    trail_amount, trail_percent, time_in_force,
    broker_override,
  })

  // Update order with broker result
  const newStatus: Order['status'] = result.status === 'open' ? 'open'
    : result.status === 'submitted' ? 'submitted'
    : result.status === 'skipped' ? 'submitted' // treat skipped as submitted in paper mode
    : 'rejected'

  const { data: updatedOrder } = await supabase
    .from('orders')
    .update({
      status: newStatus,
      broker: result.broker,
      broker_order_id: result.broker_order_id,
      error_message: result.error ?? result.reason,
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .select()
    .single()

  if (result.status === 'failed') {
    return apiError(result.error ?? 'Broker rejected order', 502, { order: updatedOrder })
  }

  return apiSuccess(updatedOrder ?? order, { broker: result.broker, broker_order_id: result.broker_order_id })
}
