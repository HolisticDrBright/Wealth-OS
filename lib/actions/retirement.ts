'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { RetirementPlan } from '@/lib/types'
import { computeRetirementSummary } from '@/lib/retirement-calculator'

const DEFAULTS: Omit<RetirementPlan, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
  target_retirement_age: 65,
  current_savings_usd: 0,
  annual_contribution_usd: 0,
  expected_return_pct: 7.0,
  inflation_rate_pct: 2.5,
  social_security_monthly_usd: 0,
  pension_monthly_usd: 0,
  ira_balance_usd: 0,
  roth_ira_balance_usd: 0,
  k401_balance_usd: 0,
  taxable_balance_usd: 0,
}

export async function getRetirementPlan(): Promise<RetirementPlan | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('retirement_plans')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (data) return data

  // Create default plan
  const { data: created } = await supabase
    .from('retirement_plans')
    .upsert({ user_id: user.id, ...DEFAULTS })
    .select()
    .single()

  return created
}

export async function upsertRetirementPlan(
  payload: Partial<Omit<RetirementPlan, 'id' | 'user_id' | 'created_at'>>
): Promise<RetirementPlan | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Compute projections
  const merged = { ...DEFAULTS, ...payload }
  const summary = computeRetirementSummary(merged as RetirementPlan)

  const { data } = await supabase
    .from('retirement_plans')
    .upsert({
      user_id: user.id,
      ...payload,
      projected_retirement_balance_usd: summary.projected_balance,
      income_gap_monthly_usd: summary.income_gap_monthly,
      on_track: summary.on_track,
      last_computed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single()

  revalidatePath('/retirement')
  return data
}
