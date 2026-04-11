/**
 * GET  /api/predict?symbol=AAPL&horizon=5
 *   Returns a combined Kronos + MiroFish signal for a symbol.
 *   Provides synthetic bars when no real market data source is configured.
 *
 * POST /api/predict
 *   Body: { symbol, news_items?, analyst_notes?, macro_context?, horizon? }
 *   Same as GET but accepts rich MiroFish seed material.
 */
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { apiSuccess, apiError } from '@/lib/api'
import { generateSyntheticBars } from '@/lib/backtester'
import { getCombinedSignal } from '@/lib/predictors'
import type { MiroFishInput } from '@/lib/predictors'

function barsForSymbol(symbol: string) {
  const end = new Date().toISOString().slice(0, 10)
  const start = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return generateSyntheticBars(symbol, start, end)
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const symbol = searchParams.get('symbol')?.toUpperCase()
  const horizon = Number(searchParams.get('horizon') ?? '5')

  if (!symbol) return apiError('symbol is required')

  const bars = barsForSymbol(symbol)
  const signal = await getCombinedSignal(symbol, bars, undefined, horizon)

  return apiSuccess(signal)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const body = await req.json()
  const { symbol, horizon = 5, news_items, analyst_notes, macro_context } = body

  if (!symbol) return apiError('symbol is required')

  const bars = barsForSymbol(symbol.toUpperCase())

  const miroInput: Omit<MiroFishInput, 'symbol'> | undefined =
    news_items || analyst_notes || macro_context
      ? { news_items, analyst_notes, macro_context, forecast_days: horizon * 5 }
      : undefined

  const signal = await getCombinedSignal(symbol.toUpperCase(), bars, miroInput, horizon)

  return apiSuccess(signal)
}
