/**
 * GET /api/risk
 *   Returns risk metrics for the authenticated user's current portfolio.
 *
 * POST /api/risk/correlation
 *   Body: { symbols }
 *   Returns correlation matrix for the specified symbols.
 */
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { apiSuccess, apiError } from '@/lib/api'
import { getBarsForSymbols, getBars } from '@/lib/market-data'
import { computeRiskMetrics, computeCorrelationMatrix, type PositionInput } from '@/lib/risk-engine'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const { data: assets } = await supabase
    .from('assets')
    .select('*')
    .eq('user_id', user.id)

  if (!assets?.length) return apiSuccess({ metrics: null, message: 'No positions found' })

  const positions: PositionInput[] = assets
    .filter(a => a.current_value > 0)
    .map(a => ({
      symbol: a.symbol ?? a.name,
      marketValue: a.current_value,
      weight: 0, // computed inside risk engine
    }))

  const total = positions.reduce((s, p) => s + p.marketValue, 0)
  for (const p of positions) p.weight = total > 0 ? p.marketValue / total : 0

  const symbols = positions.map(p => p.symbol).filter(Boolean)
  const end = new Date().toISOString().slice(0, 10)
  const start = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const [bars, benchmarkBars] = await Promise.all([
    getBarsForSymbols(symbols, start, end),
    getBars('SPY', start, end),
  ])

  const metrics = computeRiskMetrics(positions, bars, benchmarkBars)
  return apiSuccess(metrics)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')

  if (action === 'correlation') {
    const body = await req.json().catch(() => ({}))
    const { symbols } = body
    if (!symbols?.length) return apiError('symbols required')

    const end = new Date().toISOString().slice(0, 10)
    const start = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const bars = await getBarsForSymbols(symbols, start, end)
    const matrix = computeCorrelationMatrix(bars)
    return apiSuccess(matrix)
  }

  return apiError('Unknown action', 400)
}
