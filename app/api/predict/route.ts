/**
 * GET  /api/predict?symbol=AAPL&horizon=5
 *   Returns a combined Kronos + MiroFish signal for a symbol.
 *   Automatically seeds MiroFish with Finnhub news when available.
 *
 * POST /api/predict
 *   Body: { symbol, news_items?, analyst_notes?, macro_context?, horizon? }
 *   Same as GET but accepts manually provided seed material.
 */
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { apiSuccess, apiError } from '@/lib/api'
import { getBars } from '@/lib/market-data'
import { fetchCompanyNews, fetchSentiment } from '@/lib/market-data/finnhub'
import { getCombinedSignal } from '@/lib/predictors'
import type { MiroFishInput } from '@/lib/predictors'

async function buildMiroInput(symbol: string, horizonDays: number): Promise<Omit<MiroFishInput, 'symbol'> | undefined> {
  const today = new Date().toISOString().slice(0, 10)
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)

  const [news, sentiment] = await Promise.all([
    fetchCompanyNews(symbol, weekAgo, today, 10),
    fetchSentiment(symbol),
  ])

  if (!news.length && !sentiment) return undefined

  return {
    news_items: news.map(n => n.headline),
    macro_context: sentiment
      ? `Social sentiment: ${sentiment.bullishPct.toFixed(0)}% bullish, ${sentiment.bearishPct.toFixed(0)}% bearish. Buzz score: ${sentiment.buzz.toFixed(2)}.`
      : undefined,
    forecast_days: horizonDays,
  }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const symbol = searchParams.get('symbol')?.toUpperCase()
  const horizon = Number(searchParams.get('horizon') ?? '5')

  if (!symbol) return apiError('symbol is required')

  const end = new Date().toISOString().slice(0, 10)
  const start = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const [bars, miroInput] = await Promise.all([
    getBars(symbol, start, end),
    buildMiroInput(symbol, horizon * 5),
  ])

  const signal = await getCombinedSignal(symbol, bars, miroInput, horizon)
  return apiSuccess(signal)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const body = await req.json()
  const { symbol, horizon = 5, news_items, analyst_notes, macro_context } = body
  if (!symbol) return apiError('symbol is required')

  const end = new Date().toISOString().slice(0, 10)
  const start = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const bars = await getBars(symbol.toUpperCase(), start, end)

  // Merge manually provided seed material with auto-fetched Finnhub news
  let miroInput: Omit<MiroFishInput, 'symbol'> | undefined
  if (news_items || analyst_notes || macro_context) {
    miroInput = { news_items, analyst_notes, macro_context, forecast_days: horizon * 5 }
  } else {
    miroInput = await buildMiroInput(symbol.toUpperCase(), horizon * 5)
  }

  const signal = await getCombinedSignal(symbol.toUpperCase(), bars, miroInput, horizon)
  return apiSuccess(signal)
}
