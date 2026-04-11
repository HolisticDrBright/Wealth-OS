import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiSuccess, apiError } from '@/lib/api'
import { getPricing, getAccount, getOpenTrades } from '@/lib/oanda-client'
import { MAJOR_PAIRS } from '@/lib/constants/forex'

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action') ?? 'rates'

  if (!process.env.OANDA_API_KEY) {
    return apiError('OANDA_API_KEY not configured', 503)
  }

  try {
    if (action === 'rates') {
      const instruments = req.nextUrl.searchParams.get('instruments')?.split(',') ?? MAJOR_PAIRS
      const prices = await getPricing(instruments)

      // Cache to forex_rates table
      if (prices.length) {
        const supabase = createAdminClient()
        await supabase.from('forex_rates').upsert(
          prices.map(p => ({
            instrument: p.instrument,
            bid: p.bid,
            ask: p.ask,
            spread_pips: p.spread_pips,
            source: 'oanda',
            fetched_at: new Date().toISOString(),
          }))
        )
      }

      return apiSuccess(prices, { count: prices.length, source: 'oanda' })
    }

    if (action === 'account') {
      const account = await getAccount()
      return apiSuccess(account)
    }

    if (action === 'trades') {
      const trades = await getOpenTrades()
      return apiSuccess(trades, { count: trades.length })
    }

    return apiError(`Unknown action: ${action}`, 400)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'OANDA API error', 502)
  }
}
