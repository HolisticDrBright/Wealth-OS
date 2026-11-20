'use server'

/**
 * Goal-first onboarding (Phase 2.2).
 *
 * Completion marker: user_risk_profile.onboarded_at (set by
 * saveOnboardedProfile at the end of the wizard). /dashboard is gated on it.
 * The onboarding goal is stored in the EXISTING household_goals table
 * (name, goal_type, target_amount_usd, target_date,
 * monthly_contribution_usd) — no new table needed.
 */

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { HouseholdGoal } from '@/lib/types'

export async function isOnboarded(): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const { data } = await supabase
    .from('user_risk_profile')
    .select('onboarded_at')
    .eq('user_id', user.id)
    .maybeSingle()

  return !!data?.onboarded_at
}

/**
 * Save essential monthly expenses (sizes the Tier 1 safety cushion). Stored in
 * the existing financial_profile.monthly_essential_expenses_usd column.
 */
export async function saveOnboardingExpenses(
  monthlyExpensesUsd: number
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not authenticated' }
  const { saveMonthlyExpenses } = await import('@/lib/allocation/ladder-data')
  const res = await saveMonthlyExpenses(supabase, user.id, monthlyExpensesUsd)
  if (res.ok) revalidatePath('/advisor')
  return res
}

export interface OnboardingGoalInput {
  name: string
  goalType: HouseholdGoal['goal_type']
  targetAmountUsd: number
  /** ISO date (yyyy-mm-dd) or null for "no fixed date". */
  targetDate: string | null
  monthlyContributionUsd: number
}

/**
 * Saves the wizard's goal. Creates the user's household on first use (the
 * same table the Family Office page manages), then inserts the goal.
 */
export async function saveOnboardingGoal(
  input: OnboardingGoalInput
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not authenticated' }

  if (!input.name.trim()) return { ok: false, error: 'Give your goal a name' }
  if (!Number.isFinite(input.targetAmountUsd) || input.targetAmountUsd <= 0) {
    return { ok: false, error: 'Target amount must be a positive number' }
  }
  if (!Number.isFinite(input.monthlyContributionUsd) || input.monthlyContributionUsd < 0) {
    return { ok: false, error: 'Monthly contribution cannot be negative' }
  }

  // Find-or-create the household this user owns.
  const { data: existing } = await supabase
    .from('households')
    .select('id')
    .eq('owner_user_id', user.id)
    .limit(1)

  let householdId = (existing ?? [])[0]?.id as string | undefined
  if (!householdId) {
    const { data: created, error: hhErr } = await supabase
      .from('households')
      .insert({
        owner_user_id: user.id,
        name: 'My household',
        household_type: 'family',
        total_net_worth_usd: 0,
        metadata: {},
      })
      .select('id')
      .single()
    if (hhErr || !created) return { ok: false, error: hhErr?.message ?? 'could not create household' }
    householdId = created.id as string
  }

  const { error } = await supabase.from('household_goals').insert({
    household_id: householdId,
    name: input.name.trim(),
    goal_type: input.goalType,
    target_amount_usd: input.targetAmountUsd,
    current_amount_usd: 0,
    target_date: input.targetDate,
    monthly_contribution_usd: input.monthlyContributionUsd,
    status: 'active',
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/advisor')
  revalidatePath('/household')
  return { ok: true }
}
