'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { AutopilotRule } from '@/lib/types'

export async function getRules(): Promise<AutopilotRule[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('autopilot_rules')
    .select('*')
    .eq('user_id', user.id)
    .order('priority', { ascending: true })

  return data ?? []
}

export async function createRule(payload: Omit<AutopilotRule, 'id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<AutopilotRule | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('autopilot_rules')
    .insert({ user_id: user.id, ...payload })
    .select()
    .single()

  revalidatePath('/autopilot/rules')
  return data
}

export async function updateRule(
  id: string,
  payload: Partial<Omit<AutopilotRule, 'id' | 'user_id' | 'created_at'>>
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('autopilot_rules')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)

  revalidatePath('/autopilot/rules')
}

export async function deleteRule(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase.from('autopilot_rules').delete().eq('id', id).eq('user_id', user.id)
  revalidatePath('/autopilot/rules')
}

export async function reorderRules(orderedIds: string[]): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from('autopilot_rules').update({ priority: index }).eq('id', id).eq('user_id', user.id)
    )
  )
  revalidatePath('/autopilot/rules')
}
