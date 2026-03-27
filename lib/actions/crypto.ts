'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import type { CryptoPortfolioPosition, CryptoPrice } from '@/lib/types'

export async function getCryptoPortfolio(): Promise<CryptoPortfolioPosition[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('crypto_portfolio')
    .select('*')
    .eq('user_id', user.id)
    .order('balance_usd', { ascending: false })

  return data ?? []
}

export async function getCryptoPrices(symbols: string[]): Promise<CryptoPrice[]> {
  const supabase = await createClient()
  if (!symbols.length) return []

  const { data } = await supabase
    .from('crypto_prices')
    .select('*')
    .in('symbol', symbols)

  return data ?? []
}

export async function syncKrakenBalances(): Promise<{ synced: number; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { synced: 0, error: 'Not authenticated' }

  try {
    const { getBalances, getTickers } = await import('@/lib/kraken-client')
    const balances = await getBalances()

    if (!balances.length) return { synced: 0 }

    const symbols = balances.map(b => b.symbol)
    const tickers = await getTickers(symbols)
    const priceMap = Object.fromEntries(tickers.map(t => [t.symbol, t.price_usd]))

    const admin = createAdminClient()
    let synced = 0

    for (const balance of balances) {
      const price = priceMap[balance.symbol] ?? 0
      const balanceUsd = balance.balance * price

      await admin.from('crypto_portfolio').upsert({
        user_id: user.id,
        symbol: balance.symbol,
        balance: balance.balance,
        balance_usd: balanceUsd,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      synced++
    }

    revalidatePath('/crypto')
    return { synced }
  } catch (err) {
    return { synced: 0, error: err instanceof Error ? err.message : String(err) }
  }
}
