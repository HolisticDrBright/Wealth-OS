'use server'

/**
 * Employer benefits + debt profile loaders/actions (upgrade item 2).
 * First-class capture that feeds the wealth checkup, next-dollar waterfall,
 * and missing-data labels.
 */

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  employerBenefitsFromRow, debtAccountFromRow, EMPTY_EMPLOYER_BENEFITS,
  type EmployerBenefits, type DebtAccount,
} from '@/lib/advisory/benefits-debt'

export async function getEmployerBenefits(): Promise<EmployerBenefits> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return EMPTY_EMPLOYER_BENEFITS
  const { data } = await supabase
    .from('employer_benefits')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  return employerBenefitsFromRow(data as Record<string, unknown> | null)
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
  // debt_accounts has no created_at column (20260704f) — ordering by it made
  // this read fail and return no debts at all. Order by updated_at.
  const { data } = await supabase
    .from('debt_accounts')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: true })
  return ((data ?? []) as Array<Record<string, unknown>>).map(debtAccountFromRow)
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
