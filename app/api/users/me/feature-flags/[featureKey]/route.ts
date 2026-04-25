/**
 * PUT  /api/users/me/feature-flags/:featureKey
 *   Upsert the user's flag for a single feature.
 *
 * Body: { is_enabled?: boolean, monthly_budget_cents?: number, alert_threshold_pct?: number }
 *
 * Response: { feature_key, is_enabled, monthly_budget_cents, alert_threshold_pct }
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveFeatureFlags } from '@/lib/feature-flags/middleware'
import { centsToUsd, usdToCents } from '@/lib/feature-flags/FeatureFlagService'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ featureKey: string }> }
) {
  const ctx = await resolveFeatureFlags(req)
  if (ctx.error) return ctx.error

  const { supabase, userId } = ctx
  const { featureKey } = await params

  // Validate feature exists
  const { data: def } = await supabase
    .from('ai_feature_definitions')
    .select('feature_key, default_budget_usd')
    .eq('feature_key', featureKey)
    .eq('is_available', true)
    .single()

  if (!def) return NextResponse.json({ error: `Unknown feature: ${featureKey}` }, { status: 404 })

  const body = await req.json().catch(() => ({})) as {
    is_enabled?: boolean
    monthly_budget_cents?: number
    alert_threshold_pct?: number
  }

  // Get existing flag for defaults
  const { data: existing } = await supabase
    .from('ai_feature_flags')
    .select('enabled, monthly_budget_usd, alert_threshold_pct')
    .eq('user_id', userId)
    .eq('feature_key', featureKey)
    .single()

  const enabled = body.is_enabled ?? existing?.enabled ?? false
  const budgetCents = body.monthly_budget_cents ?? usdToCents(existing?.monthly_budget_usd ?? def.default_budget_usd)
  const alertPct = body.alert_threshold_pct ?? existing?.alert_threshold_pct ?? 80

  if (alertPct < 0 || alertPct > 100) {
    return NextResponse.json({ error: 'alert_threshold_pct must be 0–100' }, { status: 400 })
  }

  const { error } = await supabase.from('ai_feature_flags').upsert(
    {
      user_id: userId,
      feature_key: featureKey,
      enabled,
      monthly_budget_usd: centsToUsd(budgetCents),
      alert_threshold_pct: alertPct,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,feature_key' }
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    feature_key: featureKey,
    is_enabled: enabled,
    monthly_budget_cents: budgetCents,
    alert_threshold_pct: alertPct,
  })
}
