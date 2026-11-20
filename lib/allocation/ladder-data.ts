/**
 * Ladder loader + write cores (Phase 2) — client-agnostic: callers pass a
 * Supabase client already scoped to the user (cookie session on the web,
 * bearer client on mobile, admin client in the paper runner).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { computeLadder, ladderSetupAmount, type Ladder, type LadderGoal } from '@/lib/allocation/ladder'

export async function loadLadder(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<Ladder> {
  const [assetsRes, profileRes, riskRes, goalsRes, sleevesRes, stateRes, paperRes, copiedRes] = await Promise.all([
    supabase.from('assets').select('category, current_value').eq('user_id', userId),
    supabase.from('financial_profile').select('monthly_essential_expenses_usd').eq('user_id', userId).maybeSingle(),
    supabase.from('user_risk_profile').select('profile_key').eq('user_id', userId).maybeSingle(),
    supabase.from('household_goals')
      .select('id, name, target_amount_usd, target_date, status, households!inner(owner_user_id)')
      .eq('status', 'active')
      .eq('households.owner_user_id', userId),
    supabase.from('portfolio_sleeves').select('target_allocation_pct, metadata').eq('user_id', userId),
    supabase.from('ladder_state').select('tier1_designated_usd').eq('user_id', userId).maybeSingle(),
    supabase.from('paper_positions').select('notional_usd').eq('user_id', userId).eq('status', 'open'),
    supabase.from('user_copied_positions').select('notional_value').eq('user_id', userId).eq('status', 'open'),
  ])

  const expensesRaw = (profileRes.data as { monthly_essential_expenses_usd?: number | string | null } | null)
    ?.monthly_essential_expenses_usd
  const monthlyExpensesUsd = expensesRaw == null ? null : Number(expensesRaw)

  const explore = ((sleevesRes.data ?? []) as Array<{ target_allocation_pct: number | null; metadata: Record<string, unknown> | null }>)
    .find(s => s.metadata?.kind === 'explore')

  const goals: LadderGoal[] = ((goalsRes.data ?? []) as Array<{
    id: string; name: string; target_amount_usd: number | string; target_date: string | null
  }>).map(g => ({
    id: g.id, name: g.name,
    targetAmountUsd: Number(g.target_amount_usd),
    targetDate: g.target_date,
  }))

  const exploreInUseUsd =
    ((paperRes.data ?? []) as Array<{ notional_usd: number | null }>).reduce((s, r) => s + (r.notional_usd ?? 0), 0) +
    ((copiedRes.data ?? []) as Array<{ notional_value: number | null }>).reduce((s, r) => s + (r.notional_value ?? 0), 0)

  return computeLadder({
    assets: (assetsRes.data ?? []) as Array<{ category: string; current_value: number | null }>,
    monthlyExpensesUsd: monthlyExpensesUsd != null && Number.isFinite(monthlyExpensesUsd) ? monthlyExpensesUsd : null,
    goals,
    profileKey: (riskRes.data?.profile_key as string | undefined) ?? null,
    exploreCapFraction: explore?.target_allocation_pct != null ? Number(explore.target_allocation_pct) / 100 : null,
    tier1DesignatedUsd: Number((stateRes.data as { tier1_designated_usd?: number | string } | null)?.tier1_designated_usd ?? 0),
    exploreInUseUsd,
    now,
  })
}

/** Save essential monthly expenses (the existing financial_profile column). */
export async function saveMonthlyExpenses(
  supabase: SupabaseClient,
  userId: string,
  amountUsd: number,
): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isFinite(amountUsd) || amountUsd < 0) {
    return { ok: false, error: 'Monthly expenses must be zero or more' }
  }
  const { error } = await supabase
    .from('financial_profile')
    .upsert({ user_id: userId, monthly_essential_expenses_usd: amountUsd, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' })
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** Plain-language text the user approves for the ladder setup. */
export function ladderSetupSummary(amountUsd: number, targetUsd: number): string {
  const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
  return `Set up my safety cushion: move ${usd(amountUsd)} of practice money into a cash-like fund ` +
    `so my safety tier reaches ${usd(targetUsd)}. Nothing real is sold.`
}

/**
 * Approve the one-tap "Set up your ladder" decision: records the approval,
 * then designates the shortfall (bounded by available money) as Tier 1.
 * Nothing happens without an approved summary.
 */
export async function approveLadderSetup(
  supabase: SupabaseClient,
  userId: string,
  approvedSummary: string,
): Promise<{ ok: boolean; designatedUsd: number; ladder?: Ladder; error?: string }> {
  if (!approvedSummary.trim()) {
    return { ok: false, designatedUsd: 0, error: 'approval_required: approved summary missing' }
  }
  const ladder = await loadLadder(supabase, userId)
  if (ladder.tier1.status === 'needs_expenses') {
    return { ok: false, designatedUsd: 0, error: 'Add your monthly expenses first' }
  }
  const amount = ladderSetupAmount(ladder)
  if (amount <= 0) {
    return { ok: false, designatedUsd: 0, error: 'Nothing to set up — your safety cushion is already full' }
  }

  const { error: apprErr } = await supabase.from('automation_approvals').insert({
    user_id: userId, kind: 'setup_ladder', subject: 'ladder', summary: approvedSummary,
    metadata: { designated_usd: amount, tier1_target_usd: ladder.tier1.targetUsd },
  })
  if (apprErr) return { ok: false, designatedUsd: 0, error: `could not record approval: ${apprErr.message}` }

  const { data: existing } = await supabase
    .from('ladder_state').select('tier1_designated_usd').eq('user_id', userId).maybeSingle()
  const prior = Number((existing as { tier1_designated_usd?: number | string } | null)?.tier1_designated_usd ?? 0)

  const { error } = await supabase.from('ladder_state').upsert({
    user_id: userId,
    tier1_designated_usd: Math.round((prior + amount) * 100) / 100,
    setup_approved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (error) return { ok: false, designatedUsd: 0, error: error.message }

  return { ok: true, designatedUsd: amount, ladder: await loadLadder(supabase, userId) }
}
