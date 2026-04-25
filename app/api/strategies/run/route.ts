import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { STRATEGY_REGISTRY } from '@/lib/strategies/all-strategies'
import { getBars } from '@/lib/market-data'
import { openPaperTrade } from '@/lib/strategies/performance-tracker'

/**
 * POST /api/strategies/run
 *
 * Runs one or more strategies against a symbol and records paper trades
 * for any signals generated.
 *
 * Body: { strategy_ids: string[], symbol: string, paper?: boolean, metadata?: object }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { strategy_ids, symbol, paper = true, metadata = {} } = body as {
    strategy_ids: string[]
    symbol: string
    paper?: boolean
    metadata?: Record<string, unknown>
  }

  if (!strategy_ids?.length || !symbol) {
    return NextResponse.json({ error: 'strategy_ids and symbol are required' }, { status: 400 })
  }

  // Fetch price bars once for all strategies
  const endDate = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const bars = await getBars(symbol, startDate, endDate)

  const results: Record<string, unknown>[] = []

  for (const id of strategy_ids) {
    const strategy = STRATEGY_REGISTRY.get(id)
    if (!strategy) {
      results.push({ strategy_id: id, error: 'Unknown strategy' })
      continue
    }

    try {
      const signal = await strategy.generateSignal(symbol, bars, metadata)

      if (!signal) {
        results.push({ strategy_id: id, signal: null, message: 'No signal' })
        continue
      }

      let tradeId: string | null = null
      if (paper) {
        const entryPrice = bars[bars.length - 1]?.close ?? 0
        tradeId = await openPaperTrade({
          strategy_id: id,
          symbol,
          side: signal.side,
          entry_price: entryPrice,
          size_usd: 1000,
          entry_time: new Date().toISOString(),
          signal_strength: signal.strength,
          metadata: { ...signal.metadata, expected_return: signal.expectedReturn },
        })
      }

      results.push({
        strategy_id: id,
        signal: {
          side: signal.side,
          strength: signal.strength,
          expected_return: signal.expectedReturn,
          asset_class: signal.assetClass,
          metadata: signal.metadata,
        },
        paper_trade_id: tradeId,
      })
    } catch (err) {
      results.push({ strategy_id: id, error: String(err) })
    }
  }

  return NextResponse.json({ symbol, results, paper, ran_at: new Date().toISOString() })
}
