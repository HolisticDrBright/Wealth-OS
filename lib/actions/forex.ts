'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { ForexRate, ForexPosition } from '@/lib/types'

export const MAJOR_PAIRS = [
  'EUR_USD', 'GBP_USD', 'USD_JPY', 'USD_CHF',
  'AUD_USD', 'USD_CAD', 'NZD_USD', 'EUR_GBP',
  'EUR_JPY', 'GBP_JPY',
]

export async function getForexRates(): Promise<ForexRate[]> {
  const supabase = await createClient()

  const { data } = await supabase
    .from('forex_rates')
    .select('*')
    .in('instrument', MAJOR_PAIRS)

  return data ?? []
}

export async function getForexPositions(): Promise<ForexPosition[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('forex_positions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return data ?? []
}

export async function syncOandaPositions(): Promise<{ synced: number; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { synced: 0, error: 'Not authenticated' }

  try {
    const { getOpenTrades } = await import('@/lib/oanda-client')
    const trades = await getOpenTrades()

    let synced = 0
    for (const trade of trades) {
      await supabase.from('forex_positions').upsert({
        user_id: user.id,
        instrument: trade.instrument,
        side: trade.current_units > 0 ? 'long' : 'short',
        units: Math.abs(trade.current_units),
        avg_price: trade.price,
        unrealized_pnl: trade.unrealized_pl,
        oanda_trade_id: trade.id,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      synced++
    }

    revalidatePath('/forex')
    return { synced }
  } catch (err) {
    return { synced: 0, error: err instanceof Error ? err.message : String(err) }
  }
}
