/**
 * GET  /api/users/me/feature-flags/:featureKey/usage
 *   Returns this month's usage logs for a feature, paginated.
 *
 * Query params: page (1-based, default 1), per_page (default 50, max 200)
 *
 * Response: { logs, total, page, per_page, total_cents }
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveFeatureFlags } from '@/lib/feature-flags/middleware'
import { usdToCents } from '@/lib/feature-flags/FeatureFlagService'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ featureKey: string }> }
) {
  const ctx = await resolveFeatureFlags(req)
  if (ctx.error) return ctx.error

  const { supabase, userId } = ctx
  const { featureKey } = await params

  const { searchParams } = new URL(req.url)
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const perPage = Math.min(200, Math.max(1, parseInt(searchParams.get('per_page') ?? '50', 10)))
  const offset = (page - 1) * perPage

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  const { data: logs, error, count } = await supabase
    .from('ai_usage_logs')
    .select(
      'id, created_at, operation, cost_usd, tokens_in, tokens_out, latency_ms, trade_id, simulation_id, metadata',
      { count: 'exact' }
    )
    .eq('user_id', userId)
    .eq('feature_key', featureKey)
    .gte('created_at', monthStart)
    .order('created_at', { ascending: false })
    .range(offset, offset + perPage - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const totalCents = (logs ?? []).reduce((sum, l) => sum + usdToCents(l.cost_usd ?? 0), 0)

  return NextResponse.json({
    feature_key: featureKey,
    logs: (logs ?? []).map(l => ({
      ...l,
      cost_cents: usdToCents(l.cost_usd ?? 0),
    })),
    total: count ?? 0,
    page,
    per_page: perPage,
    total_cents: totalCents,
  })
}
