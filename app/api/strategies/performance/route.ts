import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStrategyPerformance, getTier1GateStatus } from '@/lib/strategies/performance-tracker'

/**
 * GET /api/strategies/performance?strategy_id=X&days=14
 *
 * Returns paper-trade performance for a strategy, including whether
 * the Tier 1 gate (Sharpe > 1.5, >= 14 days) has been passed.
 *
 * If strategy_id = "tier1_gate", returns status for all 5 Tier 1 strategies.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const strategyId = searchParams.get('strategy_id') ?? ''
  const days = Math.min(90, Math.max(1, parseInt(searchParams.get('days') ?? '14', 10)))

  if (strategyId === 'tier1_gate') {
    const gate = await getTier1GateStatus()
    return NextResponse.json(gate)
  }

  if (!strategyId) {
    return NextResponse.json({ error: 'strategy_id is required' }, { status: 400 })
  }

  const perf = await getStrategyPerformance(strategyId, days)
  return NextResponse.json(perf)
}
