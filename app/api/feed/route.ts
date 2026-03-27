import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { apiSuccess, apiError, getBearerToken } from '@/lib/api'

export async function GET(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Authenticate via bearer token (used by mobile) or fall back to admin for server calls
  const token = getBearerToken(req)
  let userId: string | null = null

  if (token) {
    const { data: { user } } = await supabase.auth.getUser(token)
    userId = user?.id ?? null
  }

  if (!userId) {
    return apiError('Unauthorized', 401)
  }

  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '50')
  const cursor = req.nextUrl.searchParams.get('cursor')

  // Get traders the user follows
  const { data: followed } = await supabase
    .from('user_followed_traders')
    .select('trader_id')
    .eq('user_id', userId)

  const traderIds = (followed ?? []).map((f: { trader_id: string }) => f.trader_id)

  if (traderIds.length === 0) {
    return apiSuccess([], { count: 0, cursor: null })
  }

  let query = supabase
    .from('trader_trades')
    .select(`
      id, trader_id, asset_class, symbol, action,
      quantity, price, notional_value, trade_date, metadata,
      traders!inner(id, name, handle, asset_class, avatar_url)
    `)
    .in('trader_id', traderIds)
    .order('trade_date', { ascending: false })
    .limit(limit)

  if (cursor) {
    query = query.lt('trade_date', cursor)
  }

  const { data, error } = await query

  if (error) return apiError(error.message, 500)

  const nextCursor = data && data.length === limit
    ? (data[data.length - 1] as { trade_date: string }).trade_date
    : null

  return apiSuccess(data ?? [], { count: data?.length ?? 0, cursor: nextCursor })
}
