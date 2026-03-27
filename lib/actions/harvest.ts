'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { HarvestCandidate } from '@/lib/types'

export async function getHarvestCandidates(): Promise<HarvestCandidate[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('harvest_candidates')
    .select('*')
    .eq('user_id', user.id)
    .in('status', ['pending'])
    .order('unrealized_loss_usd', { ascending: true })

  return data ?? []
}

export async function dismissCandidate(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('harvest_candidates')
    .update({ status: 'dismissed' })
    .eq('id', id)
    .eq('user_id', user.id)

  revalidatePath('/tax/harvest')
}

export async function markHarvested(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('harvest_candidates')
    .update({ status: 'harvested', harvested_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)

  revalidatePath('/tax/harvest')
}
