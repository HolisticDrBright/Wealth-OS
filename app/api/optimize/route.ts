/**
 * POST /api/optimize
 * Body: { symbols, strategy?, start_date?, end_date?, maxWeight?, minWeight?, riskFreeRate? }
 *
 * Returns optimized portfolio weights using the specified strategy.
 */
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { apiSuccess, apiError } from '@/lib/api'
import { getBarsForSymbols } from '@/lib/market-data'
import { optimizePortfolio, type OptimizationStrategy } from '@/lib/optimizer'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const body = await req.json()
  const {
    symbols,
    strategy = 'mean_variance',
    start_date,
    end_date,
    maxWeight = 0.4,
    minWeight = 0,
    riskFreeRate = 0.05,
  } = body

  if (!symbols?.length) return apiError('symbols array is required')

  const end = end_date ?? new Date().toISOString().slice(0, 10)
  const start = start_date ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const bars = await getBarsForSymbols(symbols, start, end)
  if (!bars.length) return apiError('No price data available for the provided symbols', 422)

  const result = optimizePortfolio({
    bars,
    strategy: strategy as OptimizationStrategy,
    maxWeight,
    minWeight,
    riskFreeRate,
  })

  return apiSuccess({
    weights: Object.fromEntries(result.weights),
    expectedReturn: result.expectedReturn,
    expectedVol: result.expectedVol,
    sharpe: result.sharpe,
    strategy: result.strategy,
    diagnostics: result.diagnostics,
  })
}
