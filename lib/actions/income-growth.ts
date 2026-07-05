'use server'

/**
 * Income-Growth pillar (P3) server wiring. Composes the QUANTIFIED
 * income-vs-allocation comparison (real Monte Carlo) with the COACHING idea
 * cards. A speculative income number is shown for comparison only — it NEVER
 * enters the planner's inputs. It affects projections solely when the user
 * converts it into a real profile income change via convertIncomeIdeaToProfile.
 */

import { createClient } from '@/lib/supabase/server'
import { getFinancialProfile, upsertFinancialProfile } from '@/lib/actions/advisory'
import { loadTaxConstants, loadKbParameters } from '@/lib/advisory/constants'
import { evaluateAllRules, gradeOf } from '@/lib/advisory/engine'
import {
  incomeGrowthTriggered, compareIncomeVsAllocation, generateIncomeIdeas,
  type IncomeVsAllocation, type IncomeIdea,
} from '@/lib/advisory/rules/r9-income-growth'
import type { PlanningInput } from '@/lib/planning/monte-carlo'
import { ADVISORY_DISCLAIMER } from '@/lib/advisory/types'

export interface IncomeGrowthView {
  triggered: boolean
  reason: string
  /** null when the Monte Carlo cannot run (no returns/assets/age). */
  comparison: IncomeVsAllocation | null
  ideas: IncomeIdea[]
  disclaimer: string
  error?: string
}

/** The illustrative marginal-income figure used only for the comparison. */
const COMPARISON_MONTHLY_INCOME_DELTA = 500

async function fetchSpxMonthlyReturns(): Promise<number[]> {
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
    const out: number[] = []
    for (let i = 1; i < closes.length; i++) out.push(closes[i] / closes[i - 1] - 1)
    return out
  } catch {
    return []
  }
}

export async function getIncomeGrowthView(): Promise<IncomeGrowthView> {
  const base: IncomeGrowthView = {
    triggered: false, reason: '', comparison: null, ideas: [], disclaimer: ADVISORY_DISCLAIMER,
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ...base, error: 'not signed in' }

  try {
    const [profile, constants, params] = await Promise.all([
      getFinancialProfile().catch(() => null),
      loadTaxConstants(supabase).catch(() => null),
      loadKbParameters(supabase).catch(() => null),
    ])
    if (!profile || !params) return { ...base, error: 'profile or parameters unavailable' }

    const { data: assetRows } = await supabase
      .from('assets').select('current_value').eq('user_id', user.id)
    const investable = ((assetRows ?? []) as Array<{ current_value: number }>)
      .reduce((s, r) => s + (r.current_value ?? 0), 0)

    const annualIncome = (profile.w2_wages_usd ?? 0) + (profile.net_business_profit_usd ?? 0)
    const annualSavings = Math.max(0, annualIncome * 0.2)  // proxy until savings is tracked

    // Best quantified allocation recommendation, for the comparison.
    const quantifiedBenefit = constants
      ? evaluateAllRules(profile, constants, params).recommendations
          .filter(r => gradeOf(r) === 'quantified')
          .reduce((max, r) => Math.max(max, r.estimatedAnnualBenefitUsd ?? 0), 0)
      : 0

    const trigger = incomeGrowthTriggered({
      investableUsd: investable > 0 ? investable : null,
      massAffluentThresholdUsd: params.income_pillar_investable_threshold ?? 100_000,
      annualIncomeUsd: annualIncome > 0 ? annualIncome : null,
      annualSavingsUsd: annualSavings,
      minSavingsRate: params.income_pillar_min_savings_rate ?? 0.15,
      waterfallUnfilled: (profile.ytd_401k_employee_usd ?? 0) === 0 || (profile.ytd_ira_contribution_usd ?? 0) === 0,
    })

    const ideas = generateIncomeIdeas(profile)

    // Quantified comparison — only when the Monte Carlo can actually run.
    let comparison: IncomeVsAllocation | null = null
    const returns = await fetchSpxMonthlyReturns()
    if (profile.age_self != null && profile.monthly_essential_expenses_usd != null &&
        investable > 0 && returns.length >= 60) {
      const sleeveUsd = Math.min(investable * 0.1, investable)
      const input: PlanningInput = {
        currentAge: profile.age_self,
        retireAge: Math.max(profile.age_self + 1, 65),
        horizonAge: 90,
        marketBucketUsd: investable - sleeveUsd,
        sleeveUsd,
        annualSavingsUsd: annualSavings,
        incomeStability: profile.income_stability ?? 'stable_w2',
        annualRetirementSpendUsd: profile.monthly_essential_expenses_usd * 12,
        marketMonthlyReturns: returns,
        taxDragRate: 0.005,
        paths: 2_000,
        seed: 42,
      }
      const savingsRate = annualIncome > 0 ? annualSavings / annualIncome : 0.2
      comparison = compareIncomeVsAllocation(input, COMPARISON_MONTHLY_INCOME_DELTA, savingsRate, quantifiedBenefit)
    }

    return { ...base, triggered: trigger.triggered, reason: trigger.reason, comparison, ideas }
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Profile-conversion path: the ONLY way a speculative income figure reaches
 * the plan. It adds a real monthly income change to the user's W-2 wages —
 * their number, recorded in their profile — after which normal planning uses
 * it. Nothing here is inferred by the LLM.
 */
export async function convertIncomeIdeaToProfile(
  monthlyIncomeUsd: number
): Promise<{ ok: boolean; error?: string }> {
  if (!(monthlyIncomeUsd > 0)) return { ok: false, error: 'income must be positive' }
  const profile = await getFinancialProfile()
  const currentW2 = profile?.w2_wages_usd ?? 0
  return upsertFinancialProfile({ w2_wages_usd: currentW2 + Math.round(monthlyIncomeUsd * 12) })
}
