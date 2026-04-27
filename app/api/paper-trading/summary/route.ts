import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { PaperSummary } from '@/lib/paper-trading/types'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: closed }, { data: open }] = await Promise.all([
    supabase
      .from('paper_positions')
      .select('realized_pnl_usd, strategy_key, exit_reason')
      .eq('user_id', user.id)
      .eq('status', 'closed'),
    supabase
      .from('paper_positions')
      .select('unrealized_pnl_usd, strategy_key')
      .eq('user_id', user.id)
      .eq('status', 'open'),
  ])

  const closedRows = closed ?? []
  const openRows   = open   ?? []

  const totalRealizedPnlUsd   = closedRows.reduce((s, p) => s + ((p.realized_pnl_usd as number) ?? 0), 0)
  const totalUnrealizedPnlUsd = openRows.reduce((s, p) => s + ((p.unrealized_pnl_usd as number) ?? 0), 0)

  const wins   = closedRows.filter(p => ((p.realized_pnl_usd as number) ?? 0) > 0)
  const losses = closedRows.filter(p => ((p.realized_pnl_usd as number) ?? 0) <= 0)
  const winRate = closedRows.length > 0 ? wins.length / closedRows.length : null

  const avgWinUsd  = wins.length > 0
    ? wins.reduce((s, p) => s + ((p.realized_pnl_usd as number) ?? 0), 0) / wins.length
    : null
  const avgLossUsd = losses.length > 0
    ? losses.reduce((s, p) => s + ((p.realized_pnl_usd as number) ?? 0), 0) / losses.length
    : null

  // Per-strategy breakdown
  const byStrategy: PaperSummary['byStrategy'] = {}
  for (const p of closedRows) {
    const k = p.strategy_key as string
    if (!byStrategy[k]) byStrategy[k] = { pnlUsd: 0, trades: 0, winRate: null }
    byStrategy[k].pnlUsd += (p.realized_pnl_usd as number) ?? 0
    byStrategy[k].trades++
  }
  for (const [k, v] of Object.entries(byStrategy)) {
    const stratWins = closedRows.filter(
      p => p.strategy_key === k && ((p.realized_pnl_usd as number) ?? 0) > 0
    ).length
    byStrategy[k].winRate = v.trades > 0 ? stratWins / v.trades : null
  }

  const summary: PaperSummary = {
    totalRealizedPnlUsd,
    totalUnrealizedPnlUsd,
    totalPnlUsd: totalRealizedPnlUsd + totalUnrealizedPnlUsd,
    closedTrades:  closedRows.length,
    openPositions: openRows.length,
    winRate,
    avgWinUsd,
    avgLossUsd,
    byStrategy,
  }

  return NextResponse.json(summary)
}
