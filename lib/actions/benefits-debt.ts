'use server'

/**
 * Employer benefits + debt profile loaders/actions (upgrade item 2).
 * First-class capture that feeds the wealth checkup, next-dollar waterfall,
 * and missing-data labels.
 */

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { EmployerBenefits, DebtAccount } from '@/lib/advisory/benefits-debt'

export async function getEmployerBenefits(): Promise<EmployerBenefits> {
  const empty: EmployerBenefits = {
    matchAvailable: null, matchFormula: null, matchPercent: null,
    matchCapPctOfPay: null, vestingNotes: null, onTrackForFullMatch: null,
    updatedAt: null,
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return empty
  const { data } = await supabase
    .from('employer_benefits')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!data) return empty
  return {
    matchAvailable: data.match_available ?? null,
    matchFormula: data.match_formula ?? null,
    matchPercent: data.match_percent ?? null,
    matchCapPctOfPay: data.match_cap_pct_of_pay ?? null,
    vestingNotes: data.vesting_notes ?? null,
    onTrackForFullMatch: data.on_track_for_full_match ?? null,
    updatedAt: data.updated_at ?? null,
  }
}

export async function upsertEmployerBenefits(payload: {
  match_available?: boolean
  match_formula?: string
  match_percent?: number
  match_cap_pct_of_pay?: number
  vesting_notes?: string
  on_track_for_full_match?: boolean
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not authenticated' }
  const { error } = await supabase
    .from('employer_benefits')
    .upsert({ user_id: user.id, ...payload, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/advisor')
  return { ok: true }
}

export async function getDebtAccounts(): Promise<DebtAccount[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data } = await supabase
    .from('debt_accounts')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
  return ((data ?? []) as Array<Record<string, unknown>>).map(d => ({
    id: String(d.id),
    name: String(d.name),
    debtType: String(d.debt_type),
    balanceUsd: Number(d.balance_usd ?? 0),
    aprPct: d.apr_pct != null ? Number(d.apr_pct) : null,
    minimumPaymentUsd: d.minimum_payment_usd != null ? Number(d.minimum_payment_usd) : null,
    payoffPriority: d.payoff_priority != null ? Number(d.payoff_priority) : null,
  }))
}

export async function upsertDebtAccount(payload: {
  id?: string
  name: string
  debt_type?: string
  balance_usd: number
  apr_pct?: number
  minimum_payment_usd?: number
  payoff_priority?: number
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not authenticated' }
  const row = { user_id: user.id, updated_at: new Date().toISOString(), ...payload }
  const { error } = payload.id
    ? await supabase.from('debt_accounts').update(row).eq('id', payload.id).eq('user_id', user.id)
    : await supabase.from('debt_accounts').insert(row)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/advisor')
  return { ok: true }
}
