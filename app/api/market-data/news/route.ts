/**
 * GET /api/market-data/news?symbol=AAPL
 * GET /api/market-data/news?category=general
 *
 * Returns Finnhub news for a symbol or market category.
 */
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { apiSuccess, apiError } from '@/lib/api'
import { fetchCompanyNews, fetchMarketNews } from '@/lib/market-data/finnhub'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const symbol = searchParams.get('symbol')?.toUpperCase()
  const category = (searchParams.get('category') ?? 'general') as 'general' | 'forex' | 'crypto' | 'merger'
  const limit = Math.min(Number(searchParams.get('limit') ?? '20'), 50)

  if (symbol) {
    const today = new Date().toISOString().slice(0, 10)
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)
    const news = await fetchCompanyNews(symbol, weekAgo, today, limit)
    return apiSuccess(news)
  }

  const news = await fetchMarketNews(category, limit)
  return apiSuccess(news)
}
