'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { PriceResult } from '@/app/api/prices/route'

const CRYPTO_SYMBOLS = new Set([
  'BTC','ETH','SOL','ADA','DOT','DOGE','AVAX','MATIC','LINK','UNI',
  'LTC','XRP','BNB','ATOM','FIL','AAVE','SHIB','NEAR','APT','ARB',
])

export async function refreshAssetPrices() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated', updated: 0 }

  // Get all assets with symbols
  const { data: assets, error: fetchError } = await supabase
    .from('assets')
    .select('id, symbol, quantity, current_value')
    .eq('user_id', user.id)
    .not('symbol', 'is', null)

  if (fetchError) return { error: fetchError.message, updated: 0 }
  if (!assets || assets.length === 0) return { error: null, updated: 0 }

  const stockSymbols: string[] = []
  const cryptoSymbols: string[] = []

  assets.forEach(a => {
    if (!a.symbol) return
    const sym = a.symbol.toUpperCase()
    if (CRYPTO_SYMBOLS.has(sym)) {
      cryptoSymbols.push(sym)
    } else {
      stockSymbols.push(sym)
    }
  })

  // Call our price API route
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'

  let prices: PriceResult[] = []
  try {
    const res = await fetch(`${baseUrl}/api/prices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stockSymbols, cryptoSymbols }),
    })
    const data = await res.json()
    prices = data.prices ?? []
  } catch (err) {
    return { error: `Failed to fetch prices: ${err}`, updated: 0 }
  }

  // Update each asset's current_value
  let updated = 0
  for (const asset of assets) {
    if (!asset.symbol) continue
    const priceData = prices.find(
      p => p.symbol.toUpperCase() === asset.symbol!.toUpperCase()
    )
    if (!priceData || priceData.source === 'error' || priceData.price === 0) continue

    const newValue = asset.quantity
      ? priceData.price * asset.quantity
      : priceData.price

    await supabase
      .from('assets')
      .update({ current_value: newValue, updated_at: new Date().toISOString() })
      .eq('id', asset.id)
      .eq('user_id', user.id)

    updated++
  }

  revalidatePath('/portfolio')
  revalidatePath('/dashboard')
  return { error: null, updated, prices }
}
