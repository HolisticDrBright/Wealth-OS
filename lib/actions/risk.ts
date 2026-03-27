'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { RiskControl } from '@/lib/types'

const DEFAULTS: Omit<RiskControl, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
  max_portfolio_risk_pct: 20,
  max_single_position_pct: 10,
  max_drawdown_pct: 15,
  stop_loss_enabled: false,
  volatility_threshold: 'medium',
}

export async function getRiskControls(): Promise<RiskControl | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('risk_controls')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (data) return data

  // Upsert defaults on first access
  const { data: created } = await supabase
    .from('risk_controls')
    .upsert({ user_id: user.id, ...DEFAULTS })
    .select()
    .single()

  return created
}

export async function updateRiskControls(
  payload: Partial<Omit<RiskControl, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
): Promise<RiskControl | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('risk_controls')
    .upsert({ user_id: user.id, ...payload, updated_at: new Date().toISOString() })
    .select()
    .single()

  revalidatePath('/risk')
  return data
}

export interface RiskSummary {
  total_open_notional: number
  largest_position_pct: number
  open_position_count: number
  today_pnl: number
  positions: Array<{ symbol: string; notional_value: number; pnl_usd: number; asset_class: string }>
}

export async function getRiskSummary(): Promise<RiskSummary> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const empty: RiskSummary = {
    total_open_notional: 0,
    largest_position_pct: 0,
    open_position_count: 0,
    today_pnl: 0,
    positions: [],
  }

  if (!user) return empty

  const { data: positions } = await supabase
    .from('user_copied_positions')
    .select('symbol, notional_value, pnl_usd, asset_class')
    .eq('user_id', user.id)
    .eq('status', 'open')

  if (!positions?.length) return empty

  const total = positions.reduce((s, p) => s + (p.notional_value ?? 0), 0)
  const largest = total > 0 ? Math.max(...positions.map(p => p.notional_value ?? 0)) / total * 100 : 0
  const todayPnl = positions.reduce((s, p) => s + (p.pnl_usd ?? 0), 0)

  return {
    total_open_notional: total,
    largest_position_pct: largest,
    open_position_count: positions.length,
    today_pnl: todayPnl,
    positions,
  }
}
