import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiSuccess, apiError } from '@/lib/api'
import { getTickers, getOrderBook, getBalances } from '@/lib/kraken-client'

const DEFAULT_SYMBOLS = ['BTC', 'ETH', 'SOL', 'AVAX', 'ADA', 'DOT', 'MATIC', 'LINK', 'XRP', 'DOGE']

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action') ?? 'prices'
  const symbols = req.nextUrl.searchParams.get('symbols')?.split(',') ?? DEFAULT_SYMBOLS

  try {
    if (action === 'prices') {
      const tickers = await getTickers(symbols)

      // Cache to crypto_prices table
      if (tickers.length) {
        const supabase = createAdminClient()
        await supabase.from('crypto_prices').upsert(
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
      }

      return apiSuccess(tickers, { count: tickers.length, source: 'kraken' })
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
