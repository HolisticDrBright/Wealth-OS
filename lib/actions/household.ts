'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Household, HouseholdMember, HouseholdGoal, AdvisorClient } from '@/lib/types'

// ─── Households ───────────────────────────────────────────

export async function getMyHousehold(): Promise<Household | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('households')
    .select('*, members:household_members(*), goals:household_goals(*)')
    .eq('owner_user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  return data
}

export async function createHousehold(payload: {
  name: string
  household_type?: Household['household_type']
}): Promise<Household | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('households')
    .insert({
      owner_user_id: user.id,
      household_type: 'family',
      total_net_worth_usd: 0,
      metadata: {},
      ...payload,
    })
    .select()
    .single()

  revalidatePath('/household')
  return data
}

export async function updateHousehold(
  id: string,
  payload: Partial<Pick<Household, 'name' | 'household_type' | 'estate_plan_notes' | 'total_net_worth_usd'>>
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('households')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('owner_user_id', user.id)

  revalidatePath('/household')
}

// ─── Members ─────────────────────────────────────────────

export async function addMember(
  householdId: string,
  payload: {
    name: string
    role: HouseholdMember['role']
    email?: string
    birth_year?: number
    net_worth_usd?: number
    income_usd?: number
  }
): Promise<HouseholdMember | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('household_members')
    .insert({
      household_id: householdId,
      net_worth_usd: 0,
      income_usd: 0,
      is_invited: false,
      metadata: {},
      ...payload,
    })
    .select()
    .single()

  revalidatePath('/household')
  return data
}

export async function removeMember(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  // Check ownership via household
  const { data: member } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('id', id)
    .single()

  if (!member) return

  const { data: household } = await supabase
    .from('households')
    .select('id')
    .eq('id', member.household_id)
    .eq('owner_user_id', user.id)
    .single()

  if (!household) return

  await supabase.from('household_members').delete().eq('id', id)
  revalidatePath('/household')
}

// ─── Household Goals ─────────────────────────────────────

export async function addHouseholdGoal(
  householdId: string,
  payload: {
    name: string
    goal_type: HouseholdGoal['goal_type']
    target_amount_usd: number
    target_date?: string
    notes?: string
    assigned_sleeve_id?: string
  }
): Promise<HouseholdGoal | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('household_goals')
    .insert({ household_id: householdId, current_amount_usd: 0, status: 'active', ...payload })
    .select()
    .single()

  revalidatePath('/household')
  return data
}

export async function updateHouseholdGoal(
  id: string,
  payload: Partial<Pick<HouseholdGoal, 'name' | 'target_amount_usd' | 'current_amount_usd' | 'status' | 'notes'>>
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('household_goals')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)

  revalidatePath('/household')
}

// ─── Advisor ──────────────────────────────────────────────

export async function getAdvisorClients(): Promise<AdvisorClient[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('advisor_clients')
    .select('*')
    .eq('advisor_user_id', user.id)
    .order('aum_usd', { ascending: false })

  return data ?? []
}

export async function addAdvisorClient(payload: {
  client_name: string
  client_email?: string
  aum_usd?: number
  fee_type?: AdvisorClient['fee_type']
  fee_pct?: number
  fee_flat_annual_usd?: number
  notes?: string
  household_id?: string
}): Promise<AdvisorClient | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('advisor_clients')
    .insert({
      advisor_user_id: user.id,
      status: 'prospect',
      aum_usd: 0,
      fee_type: 'percentage',
      metadata: {},
      ...payload,
    })
    .select()
    .single()

  revalidatePath('/advisor')
  return data
}

export async function updateAdvisorClient(
  id: string,
  payload: Partial<Pick<AdvisorClient, 'client_name' | 'aum_usd' | 'status' | 'notes' | 'fee_pct'>>
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('advisor_clients')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('advisor_user_id', user.id)

  revalidatePath('/advisor')
}

export async function getTotalAUM(): Promise<number> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 0

  const { data } = await supabase
    .from('advisor_clients')
    .select('aum_usd')
    .eq('advisor_user_id', user.id)
    .eq('status', 'active')

  return (data ?? []).reduce((s, c) => s + (c.aum_usd ?? 0), 0)
}
