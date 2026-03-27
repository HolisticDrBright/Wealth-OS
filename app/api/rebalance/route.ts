import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiSuccess, apiError, getBearerToken } from '@/lib/api'
import { computeRebalanceTrades, DEFAULT_TARGETS } from '@/lib/rebalance-engine'
import { submitOrder } from '@/lib/broker-router'
import type { Asset, PortfolioTarget } from '@/lib/types'

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

export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return apiError('Unauthorized', 401)

  const body = await req.json().catch(() => ({}))
  const { execute = false, threshold_pct = 5 } = body

  const supabase = createAdminClient()

  // Fetch user assets and targets
  const [assetsRes, targetsRes] = await Promise.all([
    supabase.from('assets').select('*').eq('user_id', userId),
    supabase.from('portfolio_targets').select('*').eq('user_id', userId),
  ])

  const assets = (assetsRes.data ?? []) as Asset[]
  let targets = (targetsRes.data ?? []) as PortfolioTarget[]

  // Use defaults if user hasn't set targets
  if (!targets.length) {
    targets = DEFAULT_TARGETS.map(t => ({
      ...t, id: '', user_id: userId, created_at: '', updated_at: '',
    }))
  }

  const trades = computeRebalanceTrades(assets, targets, threshold_pct)

  if (!trades.length) {
    return apiSuccess({ trades: [], suggestions: [], message: 'Portfolio is within rebalance threshold' })
  }

  // Write suggestions to DB
  await supabase.from('rebalance_suggestions').delete().eq('user_id', userId).eq('status', 'pending')

  const { data: suggestions } = await supabase
    .from('rebalance_suggestions')
    .insert(trades.map(t => ({
      user_id: userId,
      asset_class: t.asset_class,
      action: t.action,
      current_pct: t.current_pct,
      target_pct: t.target_pct,
      drift_pct: t.drift_pct,
      suggested_notional: t.suggested_notional,
      status: 'pending',
    })))
    .select()

  let executed = 0
  const errors: string[] = []

  if (execute) {
    for (const trade of trades) {
      const result = await submitOrder({
        symbol: trade.asset_class === 'stock' ? 'SPY' : trade.asset_class === 'crypto' ? 'BTC' : trade.asset_class,
        asset_class: trade.asset_class,
        side: trade.action,
        order_type: 'market',
        notional_usd: trade.suggested_notional,
      })

      if (result.status === 'open' || result.status === 'submitted') {
        executed++
        // Mark suggestion executed
        const suggestion = suggestions?.find(s => s.asset_class === trade.asset_class)
        if (suggestion) {
          await supabase.from('rebalance_suggestions')
            .update({ status: 'executed', executed_at: new Date().toISOString() })
            .eq('id', suggestion.id)
        }
      } else if (result.status === 'failed') {
        errors.push(`${trade.asset_class}: ${result.error}`)
      }
    }
  }

  return apiSuccess({ trades, suggestions: suggestions ?? [], executed, errors: errors.length ? errors : undefined })
}

export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return apiError('Unauthorized', 401)

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('rebalance_suggestions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20)

  return apiSuccess(data ?? [])
}
