'use server'

/**
 * Planning view (Gap brief C3): funded ratio + P(goal) from the block-
 * bootstrap Monte Carlo, plus ΔP(goal) per advisory recommendation.
 * Market returns come from real S&P monthly history (Yahoo), the sleeves
 * from the user's own paper trade history (n ≥ 50) or the conservative prior.
 */

import { createClient } from '@/lib/supabase/server'
import { getFinancialProfile } from '@/lib/actions/advisory'
import {
  runPlanningMonteCarlo, planningRecommendationDelta, type PlanningInput,
} from '@/lib/planning/monte-carlo'
import { fetchSpxMonthlyReturns } from '@/lib/planning/market-returns'
import { planningBuckets } from '@/lib/allocation/policy'
import type { Recommendation } from '@/lib/advisory/types'
import { LADDER_KEYS_FILTER } from '@/lib/allocation/sleeves'

export interface PlanningView {
  goalProbabilityPct: number
  fundedRatioP10: number
  fundedRatioP50: number
  fundedRatioP90: number
  maxDrawdownP50Pct: number
  paths: number
  assumptions: string[]
  deltas: Array<{ ruleId: string; title: string; deltaPct: number }>
}

// Historical market returns live in lib/planning/market-returns.ts (shared
// with goal projection and the simple dashboard — one series everywhere).

export async function getPlanningView(
  recommendations: Array<Pick<Recommendation, 'ruleId' | 'title' | 'estimatedAnnualBenefitUsd' | 'grade'>>
): Promise<PlanningView | null> {
  // COACHING cards never feed the Monte Carlo (P2/P3). They carry null benefit
  // already, but exclude by grade explicitly so it is provable, not incidental.
  recommendations = recommendations.filter(r => (r.grade ?? 'quantified') !== 'coaching')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const profile = await getFinancialProfile()
  if (!profile || profile.age_self == null || profile.monthly_essential_expenses_usd == null) {
    return null  // planning needs the profile basics — the advisory panel prompts for them
  }

  const [{ data: assets }, { data: closed }, monthlyReturns] = await Promise.all([
    supabase.from('assets').select('current_value, category').eq('user_id', user.id),
    supabase.from('paper_positions').select('realized_pnl_pct').not('strategy_key', 'in', LADDER_KEYS_FILTER).eq('user_id', user.id).eq('status', 'closed').limit(2000),
    fetchSpxMonthlyReturns(),
  ])
  if (monthlyReturns.length < 60) return null  // no fabricated return history

  const investable = ((assets ?? []) as Array<{ current_value: number }>)
    .reduce((s, r) => s + (r.current_value ?? 0), 0)
  if (investable <= 0) return null

  const sleeveTradeReturns = ((closed ?? []) as Array<{ realized_pnl_pct: number | null }>)
    .map(r => r.realized_pnl_pct)
    .filter((r): r is number => r != null)

  // Explore (sleeve) vs Core (market) buckets from the allocation policy.
  const { marketBucketUsd, sleeveUsd } = planningBuckets(investable)
  const input: PlanningInput = {
    currentAge: profile.age_self,
    retireAge: Math.max(profile.age_self + 1, 65),
    horizonAge: 90,
    marketBucketUsd,
    sleeveUsd,
    annualSavingsUsd: Math.max(0, ((profile.w2_wages_usd ?? 0) + (profile.net_business_profit_usd ?? 0)) * 0.2),
    incomeStability: profile.income_stability ?? 'stable_w2',
    annualRetirementSpendUsd: profile.monthly_essential_expenses_usd * 12,
    marketMonthlyReturns: monthlyReturns,
    sleeveTradeReturns,
    taxDragRate: 0.005,
    paths: 5_000,
    seed: 42,
  }

  const result = runPlanningMonteCarlo(input)

  const deltas: PlanningView['deltas'] = []
  for (const rec of recommendations.filter(r => (r.estimatedAnnualBenefitUsd ?? 0) > 0).slice(0, 3)) {
    const d = planningRecommendationDelta({ ...input, paths: 2_000 }, rec.estimatedAnnualBenefitUsd!)
    deltas.push({ ruleId: rec.ruleId, title: rec.title, deltaPct: d.deltaPct })
  }

  return {
    ...result,
    assumptions: [
      `Market bucket: block bootstrap over ${monthlyReturns.length} real S&P monthly returns (20y)`,
      sleeveTradeReturns.length >= 50
        ? `Sleeves: bootstrap from your ${sleeveTradeReturns.length} closed paper trades`
        : 'Sleeves: conservative fat-tailed prior, mean 0 net of costs (no free alpha assumed)',
      `Retire at ${input.retireAge}, horizon ${input.horizonAge}, spend ${Math.round(input.annualRetirementSpendUsd / 1000)}k/yr (from your essential expenses)`,
      'Projections are simulations, not guarantees.',
    ],
    deltas,
  }
}
