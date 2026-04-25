/**
 * GET  /api/users/me/feature-flags
 *   Returns all AI feature definitions joined with this user's flag state,
 *   current month usage (cents), and remaining budget.
 *
 * Response shape:
 *   { flags: FeatureFlagWithUsage[] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveFeatureFlags } from '@/lib/feature-flags/middleware'
import { usdToCents } from '@/lib/feature-flags/FeatureFlagService'

export async function GET(req: NextRequest) {
  const ctx = await resolveFeatureFlags(req)
  if (ctx.error) return ctx.error

  const { svc, supabase, userId } = ctx

  // Fetch definitions + user flags in one join query
  const { data: defs, error } = await supabase
    .from('ai_feature_definitions')
    .select(
      `feature_key, display_name, description, category,
       cost_per_use_usd, cost_unit, default_budget_usd,
       ai_feature_flags!left(enabled, monthly_budget_usd, alert_threshold_pct)`
    )
    .eq('is_available', true)
    .order('category')
    .order('feature_key')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fetch monthly usage for all features in parallel
  const usageResults = await Promise.all(
    (defs ?? []).map(d => svc.getMonthlyUsage(userId, d.feature_key))
  )

  const flags = (defs ?? []).map((def, i) => {
    const flagRow = Array.isArray(def.ai_feature_flags)
      ? def.ai_feature_flags[0]
      : def.ai_feature_flags
    const enabled: boolean = flagRow?.enabled ?? false
    const budgetUsd: number | null = flagRow?.monthly_budget_usd ?? null
    const budgetCents = budgetUsd ? usdToCents(budgetUsd) : null
    const usageCents = usageResults[i]
    const remainingCents = budgetCents !== null ? Math.max(0, budgetCents - usageCents) : null

    return {
      feature_key: def.feature_key,
      display_name: def.display_name,
      description: def.description,
      category: def.category,
      cost_per_use_cents: usdToCents(def.cost_per_use_usd),
      cost_unit: def.cost_unit,
      default_budget_cents: usdToCents(def.default_budget_usd),
      is_enabled: enabled,
      monthly_budget_cents: budgetCents,
      alert_threshold_pct: flagRow?.alert_threshold_pct ?? 80,
      usage_this_month_cents: usageCents,
      remaining_budget_cents: remainingCents,
    }
  })

  return NextResponse.json({ flags })
}
