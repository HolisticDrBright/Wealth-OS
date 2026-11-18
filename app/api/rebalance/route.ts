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

  const supabase = createAdminClient()

  // Phase 4.3: in simple mode, EXECUTING a rebalance requires an explicitly
  // approved plain-language summary, which is recorded. Suggestion-only scans
  // (execute: false) never need approval.
  if (execute) {
    const approvedSummary = typeof body.approved_summary === 'string' ? body.approved_summary.trim() : ''
    const { data: pref } = await supabase
      .from('user_ui_prefs').select('ui_mode').eq('user_id', userId).maybeSingle()
    const simpleMode = (pref?.ui_mode as string | undefined) === 'simple'
    if (simpleMode && !approvedSummary) {
      return apiError('approval_required: confirm the plain-language summary before executing a rebalance', 400)
    }
    if (approvedSummary) {
      const { error: apprErr } = await supabase.from('automation_approvals').insert({
        user_id: userId, kind: 'accept_rebalance', subject: 'rebalance', summary: approvedSummary,
      })
      if (apprErr && simpleMode) return apiError(`could not record approval: ${apprErr.message}`, 500)
    }
  }

  const result = await runRebalanceScan(supabase, userId, {
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
