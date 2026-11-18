import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiSuccess, apiError } from '@/lib/api'
import { getOrderBook, getBalances } from '@/lib/kraken-client'
import { syncCryptoPrices, DEFAULT_CRYPTO_SYMBOLS } from '@/lib/workers/market-data-sync'

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action') ?? 'prices'
  const symbols = req.nextUrl.searchParams.get('symbols')?.split(',') ?? DEFAULT_CRYPTO_SYMBOLS

  try {
    if (action === 'prices') {
      // Shared worker — same implementation the cron calls directly.
      const result = await syncCryptoPrices(createAdminClient(), symbols)
      if (!result.ok) return apiError(result.error ?? 'Kraken API error', 502)
      return apiSuccess(result.tickers, { count: result.count, source: 'kraken' })
    }

    if (action === 'orderbook') {
      const symbol = req.nextUrl.searchParams.get('symbol') ?? 'BTC'
      const depth = Number(req.nextUrl.searchParams.get('depth') ?? '10')
      const book = await getOrderBook(symbol, depth)
      return apiSuccess(book)
    }

    if (action === 'balances') {
      const balances = await getBalances()
      return apiSuccess(balances)
    }

    return apiError(`Unknown action: ${action}`, 400)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Kraken API error', 502)
  }
}
