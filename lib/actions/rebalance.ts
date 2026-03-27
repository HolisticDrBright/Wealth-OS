'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { PortfolioTarget, RebalanceSuggestion } from '@/lib/types'

export async function getPortfolioTargets(): Promise<PortfolioTarget[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('portfolio_targets')
    .select('*')
    .eq('user_id', user.id)
    .order('target_pct', { ascending: false })

  return data ?? []
}

export async function upsertTarget(
  asset_class: string,
  target_pct: number
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('portfolio_targets')
    .upsert({ user_id: user.id, asset_class, target_pct, updated_at: new Date().toISOString() })

  revalidatePath('/rebalance')
}

export async function getRebalanceSuggestions(): Promise<RebalanceSuggestion[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('rebalance_suggestions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  return data ?? []
}

export async function updateSuggestionStatus(
  id: string,
  status: RebalanceSuggestion['status']
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('rebalance_suggestions')
    .update({ status, ...(status === 'executed' ? { executed_at: new Date().toISOString() } : {}) })
    .eq('id', id)
    .eq('user_id', user.id)

  revalidatePath('/rebalance')
}
