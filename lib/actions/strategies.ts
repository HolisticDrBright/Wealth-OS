'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Strategy, StrategyPosition } from '@/lib/types'

export async function getStrategies(): Promise<Strategy[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('strategies')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return data ?? []
}

export async function createStrategy(payload: {
  name: string
  description?: string
  asset_class?: string
  type?: Strategy['type']
}): Promise<Strategy | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('strategies')
    .insert({ user_id: user.id, is_active: true, ...payload })
    .select()
    .single()

  revalidatePath('/strategies')
  return data
}

export async function updateStrategy(
  id: string,
  payload: Partial<Pick<Strategy, 'name' | 'description' | 'is_active'>>
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('strategies')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)

  revalidatePath('/strategies')
}

export async function getStrategyPositions(strategyId: string): Promise<StrategyPosition[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('strategy_positions')
    .select('*')
    .eq('strategy_id', strategyId)
    .eq('user_id', user.id)
    .order('opened_at', { ascending: false })

  return data ?? []
}

export interface StrategyMetrics {
  total_pnl: number
  win_rate: number
  open_positions: number
  closed_positions: number
  avg_pnl_per_trade: number
}

export async function computeStrategyMetrics(strategyId: string): Promise<StrategyMetrics> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const empty = { total_pnl: 0, win_rate: 0, open_positions: 0, closed_positions: 0, avg_pnl_per_trade: 0 }
  if (!user) return empty

  const { data: positions } = await supabase
    .from('strategy_positions')
    .select('pnl_usd, status')
    .eq('strategy_id', strategyId)
    .eq('user_id', user.id)

  if (!positions?.length) return empty

  const closed = positions.filter(p => p.status === 'closed')
  const wins = closed.filter(p => p.pnl_usd > 0)
  const totalPnl = positions.reduce((s, p) => s + (p.pnl_usd ?? 0), 0)

  return {
    total_pnl: totalPnl,
    win_rate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
    open_positions: positions.filter(p => p.status === 'open').length,
    closed_positions: closed.length,
    avg_pnl_per_trade: positions.length > 0 ? totalPnl / positions.length : 0,
  }
}
