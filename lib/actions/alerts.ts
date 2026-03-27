'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Alert } from '@/lib/types'

export async function getAlerts(): Promise<Alert[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('alerts')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  return data ?? []
}

export async function getUnreadAlertCount(): Promise<number> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 0

  const { count } = await supabase
    .from('alerts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('is_read', false)

  return count ?? 0
}

export async function markAlertRead(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('alerts')
    .update({ is_read: true })
    .eq('id', id)
    .eq('user_id', user.id)

  revalidatePath('/alerts')
}

export async function markAllAlertsRead(): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('alerts')
    .update({ is_read: true })
    .eq('user_id', user.id)
    .eq('is_read', false)

  revalidatePath('/alerts')
}

export async function createAlert(payload: {
  user_id: string
  type: Alert['type']
  title: string
  body?: string
  severity?: Alert['severity']
  action_url?: string
  metadata?: Record<string, unknown>
}): Promise<Alert | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('alerts')
    .insert({ severity: 'info', is_read: false, metadata: {}, ...payload })
    .select()
    .single()

  return data
}
