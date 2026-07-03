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
import type { Recommendation } from '@/lib/advisory/types'

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

let _monthlyCache: { returns: number[]; at: number } | null = null

async function fetchSpxMonthlyReturns(): Promise<number[]> {
  if (_monthlyCache && Date.now() - _monthlyCache.at < 86_400_000) return _monthlyCache.returns
  try {
    const res = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1mo&range=20y',
      { signal: AbortSignal.timeout(8_000) }
    )
    if (!res.ok) return []
    const data: unknown = await res.json()
    const result = ((data as Record<string, unknown>)?.chart as Record<string, unknown>)?.result as unknown[]
    const quote = (((result?.[0] as Record<string, unknown>)?.indicators as Record<string, unknown>)
      ?.quote as unknown[])?.[0] as Record<string, unknown>
    const closes = (quote?.close as Array<number | null> | undefined ?? [])
      .filter((c): c is number => typeof c === 'number' && c > 0)
    const returns: number[] = []
    for (let i = 1; i < closes.length; i++) returns.push(closes[i] / closes[i - 1] - 1)
    if (returns.length >= 60) _monthlyCache = { returns, at: Date.now() }
    return returns
  } catch {
    return []
  }
}

export async function getPlanningView(
  recommendations: Array<Pick<Recommendation, 'ruleId' | 'title' | 'estimatedAnnualBenefitUsd'>>
): Promise<PlanningView | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const profile = await getFinancialProfile()
  if (!profile || profile.age_self == null || profile.monthly_essential_expenses_usd == null) {
    return null  // planning needs the profile basics — the advisory panel prompts for them
  }

  const [{ data: assets }, { data: closed }, monthlyReturns] = await Promise.all([
    supabase.from('assets').select('current_value, category').eq('user_id', user.id),
    supabase.from('paper_positions').select('realized_pnl_pct').eq('user_id', user.id).eq('status', 'closed').limit(2000),
    fetchSpxMonthlyReturns(),
  ])
  if (monthlyReturns.length < 60) return null  // no fabricated return history

  const investable = ((assets ?? []) as Array<{ current_value: number }>)
    .reduce((s, r) => s + (r.current_value ?? 0), 0)
  if (investable <= 0) return null

  const sleeveTradeReturns = ((closed ?? []) as Array<{ realized_pnl_pct: number | null }>)
    .map(r => r.realized_pnl_pct)
    .filter((r): r is number => r != null)

  // Sleeve share approximated by tier cap until per-bucket tagging exists.
  const sleeveUsd = Math.min(investable * 0.1, investable)
  const input: PlanningInput = {
    currentAge: profile.age_self,
    retireAge: Math.max(profile.age_self + 1, 65),
    horizonAge: 90,
    marketBucketUsd: investable - sleeveUsd,
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
