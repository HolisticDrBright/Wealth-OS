/**
 * Market-data sync workers — direct-call versions of the /api/kraken?action=prices
 * and /api/oanda?action=rates route bodies, so the cron never needs an HTTP hop
 * (Phase 1.2). The routes call these too: one implementation, two entry points.
 */

import type { createAdminClient } from '@/lib/supabase/admin'
import { getTickers } from '@/lib/kraken-client'
import { getPricing } from '@/lib/oanda-client'
import { MAJOR_PAIRS } from '@/lib/constants/forex'

type AdminClient = ReturnType<typeof createAdminClient>

export const DEFAULT_CRYPTO_SYMBOLS = ['BTC', 'ETH', 'SOL', 'AVAX', 'ADA', 'DOT', 'MATIC', 'LINK', 'XRP', 'DOGE']

export interface CryptoSyncResult {
  ok: boolean
  count: number
  error?: string
  tickers: Awaited<ReturnType<typeof getTickers>>
}

export async function syncCryptoPrices(
  supabase: AdminClient,
  symbols: string[] = DEFAULT_CRYPTO_SYMBOLS
): Promise<CryptoSyncResult> {
  try {
    const tickers = await getTickers(symbols)
    if (tickers.length) {
      const { error } = await supabase.from('crypto_prices').upsert(
        tickers.map(t => ({
          symbol: t.symbol,
          pair: t.pair,
          price_usd: t.price_usd,
          bid: t.bid,
          ask: t.ask,
          volume_24h: t.volume_24h,
          high_24h: t.high_24h,
          low_24h: t.low_24h,
          source: 'kraken',
          fetched_at: new Date().toISOString(),
        }))
      )
      if (error) return { ok: false, count: tickers.length, error: `cache upsert failed: ${error.message}`, tickers }
    }
    return { ok: true, count: tickers.length, tickers }
  } catch (err) {
    return { ok: false, count: 0, error: err instanceof Error ? err.message : 'Kraken API error', tickers: [] }
  }
}

export interface ForexSyncResult {
  ok: boolean
  count: number
  error?: string
  prices: Awaited<ReturnType<typeof getPricing>>
}

export async function syncForexRates(
  supabase: AdminClient,
  instruments: string[] = MAJOR_PAIRS
): Promise<ForexSyncResult> {
  if (!process.env.OANDA_API_KEY) {
    return { ok: false, count: 0, error: 'OANDA_API_KEY not configured', prices: [] }
  }
  try {
    const prices = await getPricing(instruments)
    if (prices.length) {
      const { error } = await supabase.from('forex_rates').upsert(
        prices.map(p => ({
          instrument: p.instrument,
          bid: p.bid,
          ask: p.ask,
          spread_pips: p.spread_pips,
          source: 'oanda',
          fetched_at: new Date().toISOString(),
        }))
      )
      if (error) return { ok: false, count: prices.length, error: `cache upsert failed: ${error.message}`, prices }
    }
    return { ok: true, count: prices.length, prices }
  } catch (err) {
    return { ok: false, count: 0, error: err instanceof Error ? err.message : 'OANDA API error', prices: [] }
  }
}
