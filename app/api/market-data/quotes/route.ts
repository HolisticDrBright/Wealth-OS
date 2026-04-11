/**
 * GET /api/market-data/quotes?symbols=AAPL,MSFT
 * GET /api/market-data/quotes?symbol=AAPL
 *
 * One-shot quote fetch — used by portfolio page, positions table, etc.
 */
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { apiSuccess, apiError } from '@/lib/api'
import { getQuotes, getQuote } from '@/lib/market-data'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const single = searchParams.get('symbol')
  const multi = searchParams.get('symbols')

  if (single) {
    const quote = await getQuote(single.toUpperCase())
    if (!quote) return apiError(`No quote found for ${single}`, 404)
    return apiSuccess(quote)
  }

  if (multi) {
    const symbols = multi.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 50)
    const quotes = await getQuotes(symbols)
    return apiSuccess(Object.fromEntries(quotes))
  }

  return apiError('symbol or symbols parameter required')
}
