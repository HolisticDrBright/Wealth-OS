import { NextResponse } from 'next/server'
import { PolymarketIntelligenceAgent } from '@/lib/agents/agents/polymarket-intelligence-agent'
import {
  getHealth,
  getActiveMarkets,
  getSignals,
  getPortfolio,
} from '@/lib/meta-poly/client'
import { createClient } from '@/lib/supabase/server'

const agent = new PolymarketIntelligenceAgent()

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  // Fetch fresh context from the sidecar
  const [healthRes, marketsRes, signalsRes, portfolioRes] = await Promise.all([
    getHealth(),
    getActiveMarkets({ limit: 50 }),
    getSignals({ limit: 30 }),
    getPortfolio(),
  ])

  if (!healthRes.ok) {
    return NextResponse.json(
      { error: `Sidecar unreachable: ${healthRes.error.message}` },
      { status: 503 }
    )
  }

  const analysis = await agent.analyze({
    health: healthRes.value,
    topMarkets: marketsRes.ok ? marketsRes.value : [],
    recentSignals: signalsRes.ok ? signalsRes.value.signals : [],
    openPositions: portfolioRes.ok ? portfolioRes.value.positions.positions : [],
    portfolioStats: portfolioRes.ok
      ? portfolioRes.value.stats
      : {
          balance: healthRes.value.balance,
          starting_capital: healthRes.value.starting_capital,
          total_exposure: healthRes.value.total_exposure,
          unrealized_pnl: healthRes.value.unrealized_pnl,
          realized_pnl: healthRes.value.realized_pnl,
          win_rate: healthRes.value.win_rate,
          sharpe_ratio: healthRes.value.sharpe_ratio,
          max_drawdown: healthRes.value.max_drawdown,
          trades_today: healthRes.value.trades_today,
          paper_trading: healthRes.value.paper_trading,
          markets_count: healthRes.value.markets_count,
          positions_count: healthRes.value.positions_count,
          pending_signals: healthRes.value.pending_signals,
          scheduler_running: healthRes.value.scheduler_running,
        },
  })

  return NextResponse.json(analysis)
}
