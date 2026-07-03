'use server'

/**
 * Advisory server actions — profile CRUD, rule evaluation, and the
 * advisory_log lifecycle (New → Reviewing → In progress → Done / Dismissed).
 *
 * Compliance: every recommendation SHOWN is logged with the profile snapshot
 * and rule version that produced it; every card renders the disclaimer and
 * CPA CTA (ADVISORY_DISCLAIMER).
 */

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { evaluateAllRules } from '@/lib/advisory/engine'
import { loadTaxConstants, loadKbParameters } from '@/lib/advisory/constants'
import { fetchCurrentYields, type YieldSnapshot } from '@/lib/advisory/yields'
import {
  ADVISORY_DISCLAIMER,
  type FinancialProfile, type RuleVerdict, type Recommendation,
} from '@/lib/advisory/types'

const EMPTY_PROFILE: FinancialProfile = {
  filing_status: null, age_self: null, age_spouse: null, state: null,
  business_entity: null, net_business_profit_usd: null, w2_wages_usd: null,
  prior_year_wages_usd: null, magi_estimate_usd: null, health_plan_type: null,
  monthly_essential_expenses_usd: null, liquid_cash_usd: null,
  income_stability: null, has_employees: null, spouse_only_employee: null,
  traditional_ira_balance_usd: null, ytd_401k_employee_usd: null,
  ytd_ira_contribution_usd: null, ytd_hsa_contribution_usd: null,
  has_separate_business_bank: null, home_office_sqft: null,
  business_miles_annual: null,
}

export interface AdvisoryLogRow {
  id: string
  rule_id: string
  rule_version: number
  status: string
  estimated_annual_benefit_usd: number | null
  recommendation: Recommendation
  created_at: string
}

export interface AdvisoryView {
  profile: FinancialProfile
  profileComplete: boolean
  verdicts: RuleVerdict[]
  recommendations: Recommendation[]
  totalEstimatedAnnualBenefitUsd: number
  statuses: Record<string, { logId: string; status: string }>
  yields: YieldSnapshot | null
  disclaimer: string
  error?: string
}

export async function getFinancialProfile(): Promise<FinancialProfile | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('financial_profile')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!data) return null
  const profile = { ...EMPTY_PROFILE }
  for (const key of Object.keys(EMPTY_PROFILE) as Array<keyof FinancialProfile>) {
    if (data[key] !== undefined) (profile as Record<string, unknown>)[key] = data[key]
  }
  return profile
}

export async function upsertFinancialProfile(payload: Partial<FinancialProfile>): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not authenticated' }

  const { error } = await supabase
    .from('financial_profile')
    .upsert(
      { user_id: user.id, ...payload, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
  if (error) return { ok: false, error: error.message }
  revalidatePath('/advisor')
  return { ok: true }
}

export async function getAdvisoryView(): Promise<AdvisoryView | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const base: AdvisoryView = {
    profile: EMPTY_PROFILE,
    profileComplete: false,
    verdicts: [],
    recommendations: [],
    totalEstimatedAnnualBenefitUsd: 0,
    statuses: {},
    yields: null,
    disclaimer: ADVISORY_DISCLAIMER,
  }

  const profile = (await getFinancialProfile()) ?? EMPTY_PROFILE
  base.profile = profile
  base.profileComplete = profile.filing_status !== null

  let constants, params
  try {
    ;[constants, params] = await Promise.all([
      loadTaxConstants(supabase),
      loadKbParameters(supabase),
    ])
  } catch (err) {
    // Missing seed/migration must be loud, never silently computed around.
    return { ...base, error: err instanceof Error ? err.message : String(err) }
  }

  const { verdicts, recommendations, totalEstimatedAnnualBenefitUsd } =
    evaluateAllRules(profile, constants, params)

  // Log every SHOWN recommendation once per (rule, version) active window.
  const { data: existing } = await supabase
    .from('advisory_log')
    .select('id, rule_id, rule_version, status')
    .eq('user_id', user.id)
    .in('status', ['new', 'reviewing', 'in_progress'])
  const active = new Map(
    ((existing ?? []) as Array<{ id: string; rule_id: string; rule_version: number; status: string }>)
      .map(r => [`${r.rule_id}:${r.rule_version}`, r])
  )

  const statuses: Record<string, { logId: string; status: string }> = {}
  for (const rec of recommendations) {
    const key = `${rec.ruleId}:${rec.ruleVersion}`
    const found = active.get(key)
    if (found) {
      statuses[rec.ruleId] = { logId: found.id, status: found.status }
      continue
    }
    const { data: inserted, error } = await supabase
      .from('advisory_log')
      .insert({
        user_id: user.id,
        rule_id: rec.ruleId,
        rule_version: rec.ruleVersion,
        status: 'new',
        estimated_annual_benefit_usd: rec.estimatedAnnualBenefitUsd,
        recommendation: rec,
        profile_snapshot: profile,
      })
      .select('id')
      .single()
    if (!error && inserted) statuses[rec.ruleId] = { logId: inserted.id as string, status: 'new' }
  }

  // Live yields for the emergency-fund card — never hardcoded.
  const yields = recommendations.some(r => r.ruleId === 'r3_emergency_fund')
    ? await fetchCurrentYields().catch(() => null)
    : null

  return {
    ...base,
    verdicts,
    recommendations,
    totalEstimatedAnnualBenefitUsd,
    statuses,
    yields,
  }
}

const VALID_STATUSES = ['new', 'reviewing', 'in_progress', 'done', 'dismissed'] as const

export async function updateAdvisoryStatus(
  logId: string,
  status: (typeof VALID_STATUSES)[number],
  dismissedReason?: string
): Promise<{ ok: boolean; error?: string }> {
  if (!VALID_STATUSES.includes(status)) return { ok: false, error: 'invalid status' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not authenticated' }

  const { error } = await supabase
    .from('advisory_log')
    .update({
      status,
      dismissed_reason: status === 'dismissed' ? (dismissedReason ?? null) : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', logId)
    .eq('user_id', user.id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/advisor')
  return { ok: true }
}
