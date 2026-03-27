'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Opportunity } from '@/lib/types'

export async function getOpportunities(): Promise<Opportunity[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('opportunities')
    .select('*')
    .or(`user_id.eq.${user.id},user_id.is.null`)
    .order('score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50)

  return data ?? []
}

export async function markOpportunityRead(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('opportunities')
    .update({ is_read: true })
    .eq('id', id)
    .eq('user_id', user.id)

  revalidatePath('/opportunities')
}

export async function createOpportunity(payload: {
  user_id?: string
  source: Opportunity['source']
  symbol?: string
  asset_class?: string
  title: string
  description?: string
  action?: Opportunity['action']
  confidence?: Opportunity['confidence']
  score?: number
  expires_at?: string
  metadata?: Record<string, unknown>
}): Promise<Opportunity | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('opportunities')
    .insert({ is_read: false, metadata: {}, ...payload })
    .select()
    .single()

  revalidatePath('/opportunities')
  return data
}
