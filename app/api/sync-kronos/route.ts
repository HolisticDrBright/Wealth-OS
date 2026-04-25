'use server'

import { NextRequest, NextResponse } from 'next/server'
import { kronosPredictBatch } from '@/lib/predictors/kronos'
import { createAdminClient } from '@/lib/supabase/admin'
import type { PriceBar } from '@/lib/backtester'

// Nightly worker: fetches recent price bars and caches Kronos forecasts.
// Called by: cron job with Authorization: Bearer ${CRON_SECRET}

const WATCHLIST = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'BRK.B',
  'JPM', 'UNH', 'V', 'XOM', 'JNJ', 'WMT', 'MA', 'PG', 'HD',
  'BTC', 'ETH', 'SOL', 'ADA', 'AVAX', 'LINK', 'DOT',
  'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CAD',
  'GLD', 'SLV', 'TLT', 'QQQ', 'SPY', 'IWM',
]

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()

    // Build symbol→bars map from recent price data in DB
    const symbolBars = await buildSymbolBarsMap(supabase, WATCHLIST)

    if (symbolBars.size === 0) {
      return NextResponse.json({ message: 'No price data available', synced: 0 })
    }

    const forecasts = await kronosPredictBatch(symbolBars)

    // Upsert forecasts — delete stale entries first, then insert fresh ones
    const rows = Array.from(forecasts.values()).map(f => ({
      symbol: f.symbol,
      horizon: f.horizon,
      predicted_closes: f.predicted_closes,
      expected_return: f.expected_return,
      direction: f.direction,
      confidence: f.confidence,
      source: f.source,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }))

    const { error } = await supabase.from('kronos_forecasts').insert(rows)
    if (error) throw error

    // Clean up expired forecasts
    await supabase
      .from('kronos_forecasts')
      .delete()
      .lt('expires_at', new Date().toISOString())

    return NextResponse.json({ message: 'Kronos sync complete', synced: rows.length })
  } catch (err) {
    console.error('[sync-kronos]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

async function buildSymbolBarsMap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  symbols: string[]
): Promise<Map<string, PriceBar[]>> {
  const map = new Map<string, PriceBar[]>()

  // Fetch last 120 days of daily bars from the price_history table (if it exists)
  // Falls back to empty map gracefully if table doesn't exist yet
  try {
    const since = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const { data } = await supabase
      .from('price_history')
      .select('symbol, date, open, high, low, close, volume')
      .in('symbol', symbols)
      .gte('date', since)
      .order('date', { ascending: true })

    if (!data) return map

    for (const row of data) {
      if (!map.has(row.symbol)) map.set(row.symbol, [])
      map.get(row.symbol)!.push({
        date: row.date,
        symbol: row.symbol,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume ?? 0,
      })
    }
  } catch {
    // Table may not exist yet — return empty, Kronos will use momentum fallback
  }

  return map
}
