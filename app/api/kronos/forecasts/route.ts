/**
 * GET /api/kronos/forecasts?symbol=...&strategy=...
 *
 * Returns the latest non-expired Kronos forecast for a symbol/strategy pair.
 * Requires the user's kronos feature flag to be enabled.
 *
 * Query params:
 *   symbol    Required. Ticker symbol, e.g. 'SPY', 'BTCUSDT'
 *   strategy  Optional. StrategyKey — filters to the forecast for that strategy.
 *             If omitted, returns the most recent forecast for the symbol
 *             across all strategies.
 *
 * Response: { forecast } or { forecast: null, reason }
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveFeatureFlags } from '@/lib/feature-flags/middleware'
import { isStrategyKey } from '@/lib/strategies/strategy-registry'

export async function GET(req: NextRequest) {
  const ctx = await resolveFeatureFlags(req)
  if (ctx.error) return ctx.error

  const { supabase, userId } = ctx
  const { searchParams } = new URL(req.url)
  const symbol = searchParams.get('symbol')
  const strategy = searchParams.get('strategy')

  if (!symbol) {
    return NextResponse.json({ error: 'symbol query param is required' }, { status: 400 })
  }
  if (strategy && !isStrategyKey(strategy)) {
    return NextResponse.json({ error: `Unknown strategy: ${strategy}` }, { status: 400 })
  }

  let query = supabase
    .from('kronos_forecasts')
    .select('*')
    .eq('user_id', userId)
    .eq('symbol', symbol)
    .gt('expires_at', new Date().toISOString())
    .order('generated_at', { ascending: false })
    .limit(1)

  if (strategy) {
    query = query.eq('strategy_key', strategy)
  }

  const { data: forecast, error } = await query.single()

  if (error || !forecast) {
    return NextResponse.json({
      forecast: null,
      reason: 'No current forecast available — run the nightly sync or request a manual forecast',
    })
  }

  return NextResponse.json({ forecast })
}
