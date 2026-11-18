import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiSuccess, apiError, getBearerToken } from '@/lib/api'
import { runRebalanceScan } from '@/lib/workers/rebalance-scan'

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

  const result = await runRebalanceScan(createAdminClient(), userId, {
    executeTrades: execute,
    thresholdPct: threshold_pct,
  })

  if (result.message && !result.trades.length) {
    return apiSuccess({ trades: [], suggestions: [], message: result.message })
  }
  return apiSuccess(result)
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
