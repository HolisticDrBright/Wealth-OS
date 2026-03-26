'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { fetchStockPrices, fetchCryptoPrices, CRYPTO_SYMBOLS } from '@/lib/prices'
import type { PriceResult } from '@/lib/prices'

export async function refreshAssetPrices(): Promise<{ error: string | null; updated: number; prices: PriceResult[] }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated', updated: 0, prices: [] }

  const { data: assets, error: fetchError } = await supabase
    .from('assets')
    .select('id, symbol, quantity, current_value')
    .eq('user_id', user.id)
    .not('symbol', 'is', null)

  if (fetchError) return { error: fetchError.message, updated: 0, prices: [] }
  if (!assets || assets.length === 0) return { error: 'No assets with symbols found. Add a ticker symbol (e.g. AAPL, BTC) to your assets first.', updated: 0, prices: [] }

  const stockSymbols: string[] = []
  const cryptoSymbols: string[] = []

  for (const a of assets) {
    if (!a.symbol) continue
    const sym = a.symbol.toUpperCase()
    if (CRYPTO_SYMBOLS.has(sym)) cryptoSymbols.push(sym)
    else stockSymbols.push(sym)
  }

  const finnhubKey = process.env.FINNHUB_API_KEY ?? ''

  const [stockPrices, cryptoPrices] = await Promise.all([
    fetchStockPrices(stockSymbols, finnhubKey),
    fetchCryptoPrices(cryptoSymbols),
  ])

  const allPrices: PriceResult[] = [...cryptoPrices, ...stockPrices]

  let updated = 0
  for (const asset of assets) {
    if (!asset.symbol) continue
    const pd = allPrices.find(p => p.symbol.toUpperCase() === asset.symbol!.toUpperCase())
    if (!pd || pd.source === 'error' || pd.price === 0) continue

    const newValue = asset.quantity ? pd.price * asset.quantity : pd.price
    await supabase
      .from('assets')
      .update({ current_value: newValue, updated_at: new Date().toISOString() })
      .eq('id', asset.id)
      .eq('user_id', user.id)
    updated++
  }

  revalidatePath('/portfolio')
  revalidatePath('/dashboard')
  return { error: null, updated, prices: allPrices }
}
