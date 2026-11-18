import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiSuccess, apiError } from '@/lib/api'
import { getAccount, getOpenTrades } from '@/lib/oanda-client'
import { MAJOR_PAIRS } from '@/lib/constants/forex'
import { syncForexRates } from '@/lib/workers/market-data-sync'

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action') ?? 'rates'

  if (!process.env.OANDA_API_KEY) {
    return apiError('OANDA_API_KEY not configured', 503)
  }

  try {
    if (action === 'rates') {
      const instruments = req.nextUrl.searchParams.get('instruments')?.split(',') ?? MAJOR_PAIRS
      // Shared worker — same implementation the cron calls directly.
      const result = await syncForexRates(createAdminClient(), instruments)
      if (!result.ok) return apiError(result.error ?? 'OANDA API error', 502)
      return apiSuccess(result.prices, { count: result.count, source: 'oanda' })
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
