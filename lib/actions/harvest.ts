'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { HarvestCandidate } from '@/lib/types'
import type { LotMethod } from '@/lib/tax-lots'
import { addToWashSaleBlocklist } from '@/lib/tax/wash-sale-guard'

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

export async function markHarvested(id: string, lotMethod: LotMethod = 'hifo'): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const harvestedAt = new Date().toISOString()

  const { data: candidate } = await supabase
    .from('harvest_candidates')
    .select('symbol, asset_class, unrealized_loss_usd')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  await supabase
    .from('harvest_candidates')
    .update({
      status: 'harvested',
      harvested_at: harvestedAt,
      metadata: { lot_method: lotMethod },
    })
    .eq('id', id)
    .eq('user_id', user.id)

  // Wash-sale enforcement: block repurchases of the harvested symbol for
  // 31 days so the loss isn't disallowed (IRC §1091).
  if (candidate) {
    await addToWashSaleBlocklist(supabase, user.id, {
      symbol: candidate.symbol,
      assetClass: candidate.asset_class,
      lossAmountUsd: Math.abs(candidate.unrealized_loss_usd ?? 0),
      harvestedAt,
    })
  }

  revalidatePath('/tax/harvest')
}
