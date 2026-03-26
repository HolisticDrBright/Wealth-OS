'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Trader, UserCopiedPosition } from '@/lib/types'

export async function getTraders(assetClass?: string): Promise<Trader[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  let query = supabase
    .from('traders')
    .select('*')
    .eq('is_active', true)
    .order('total_return_pct', { ascending: false })

  if (assetClass && assetClass !== 'all') {
    query = query.eq('asset_class', assetClass)
  }

  const { data: traders, error } = await query
  if (error) { console.error('getTraders:', error); return [] }

  // Fetch user's follow settings
  const { data: follows } = await supabase
    .from('user_followed_traders')
    .select('*')
    .eq('user_id', user.id)

  const followMap = new Map((follows ?? []).map(f => [f.trader_id, f]))

  return (traders ?? []).map(t => ({
    ...t,
    follow_settings: followMap.get(t.id) ?? null,
  }))
}

export async function getTraderWithTrades(traderId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [{ data: trader }, { data: trades }, { data: follow }] = await Promise.all([
    supabase.from('traders').select('*').eq('id', traderId).single(),
    supabase
      .from('trader_trades')
      .select('*')
      .eq('trader_id', traderId)
      .order('trade_date', { ascending: false })
      .limit(50),
    supabase
      .from('user_followed_traders')
      .select('*')
      .eq('user_id', user.id)
      .eq('trader_id', traderId)
      .maybeSingle(),
  ])

  if (!trader) return null
  return { ...trader, follow_settings: follow ?? null, trades: trades ?? [] }
}

export async function followTrader(traderId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase.from('user_followed_traders').insert({
    user_id: user.id,
    trader_id: traderId,
    auto_copy_enabled: false,
    max_allocation_pct_per_trade: 5,
    risk_level: 'moderate',
  })

  if (error) return { error: error.message }


  revalidatePath('/traders')
  revalidatePath('/autopilot')
  return { success: true }
}

export async function unfollowTrader(traderId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('user_followed_traders')
    .delete()
    .eq('user_id', user.id)
    .eq('trader_id', traderId)

  if (error) return { error: error.message }
  revalidatePath('/traders')
  revalidatePath('/autopilot')
  return { success: true }
}

export async function updateCopySettings(
  traderId: string,
  settings: {
    auto_copy_enabled?: boolean
    max_allocation_pct_per_trade?: number
    risk_level?: string
    max_daily_copy_usd?: number | null
    copy_asset_classes?: string[]
  }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('user_followed_traders')
    .update({ ...settings, updated_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('trader_id', traderId)

  if (error) return { error: error.message }
  revalidatePath('/autopilot')
  return { success: true }
}

export async function getFollowedTraders() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('user_followed_traders')
    .select('*, traders(*)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) { console.error('getFollowedTraders:', error); return [] }
  return data ?? []
}

export async function getCopiedPositions(): Promise<UserCopiedPosition[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('user_copied_positions')
    .select('*, traders(name, handle, asset_class)')
    .eq('user_id', user.id)
    .order('opened_at', { ascending: false })
    .limit(100)

  if (error) { console.error('getCopiedPositions:', error); return [] }
  return (data ?? []).map(p => ({
    ...p,
    trader: p.traders as UserCopiedPosition['trader'],
  }))
}
