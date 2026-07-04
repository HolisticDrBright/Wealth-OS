'use server'

/**
 * Household goals summary loader (upgrade item 6). Reads the existing
 * household_goals table (via the user's household) and produces the simple,
 * labeled straight-line summary — no hidden projections.
 */

import { createClient } from '@/lib/supabase/server'
import { summarizeGoals, type GoalsSummary, type GoalType } from '@/lib/advisory/goals'

export async function getGoalsSummary(): Promise<GoalsSummary & { error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ...summarizeGoals([]), error: 'not signed in' }

  try {
    const { data: households } = await supabase
      .from('households')
      .select('id')
      .eq('owner_user_id', user.id)
      .limit(5)
    const ids = (households ?? []).map(h => h.id as string)
    if (ids.length === 0) return summarizeGoals([])

    const { data: goals } = await supabase
      .from('household_goals')
      .select('*')
      .in('household_id', ids)
      .limit(100)

    return summarizeGoals(((goals ?? []) as Array<Record<string, unknown>>).map(g => ({
      id: String(g.id),
      name: String(g.name),
      goalType: (g.goal_type ?? 'general') as GoalType,
      targetAmountUsd: Number(g.target_amount_usd ?? 0),
      currentAmountUsd: Number(g.current_amount_usd ?? 0),
      targetDate: (g.target_date as string | null) ?? null,
      monthlyContributionUsd: g.monthly_contribution_usd != null ? Number(g.monthly_contribution_usd) : null,
      status: String(g.status ?? 'active'),
      notes: (g.notes as string | null) ?? null,
    })))
  } catch (err) {
    return { ...summarizeGoals([]), error: err instanceof Error ? err.message : String(err) }
  }
}
