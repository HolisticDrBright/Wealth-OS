import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { PaperSummary } from '@/lib/paper-trading/types'

function assetClassFilter(assetClass: string | null): string[] | null {
  if (!assetClass) return null
  if (assetClass === 'crypto') return ['crypto', 'crypto_spot', 'crypto_futures', 'crypto_perp']
  if (assetClass === 'options') return ['options', 'option', 'equity_options']
  if (assetClass === 'stocks') return ['stocks', 'stock', 'equity']
  return [assetClass]
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const assetClass = new URL(req.url).searchParams.get('assetClass')
  const assetClasses = assetClassFilter(assetClass)

  let closedQuery = supabase
    .from('paper_positions')
    .select('realized_pnl_usd, strategy_key, exit_reason')
    .eq('user_id', user.id)
    .eq('status', 'closed')

  let openQuery = supabase
    .from('paper_positions')
    .select('unrealized_pnl_usd, strategy_key')
    .eq('user_id', user.id)
    .eq('status', 'open')

  if (assetClasses) {
    closedQuery = closedQuery.in('asset_class', assetClasses)
    openQuery = openQuery.in('asset_class', assetClasses)
  }

  const [{ data: closed }, { data: open }] = await Promise.all([closedQuery, openQuery])

  const closedRows = closed ?? []
  const openRows   = open   ?? []

  if (assetClasses && closedRows.length === 0 && openRows.length === 0) {
    const { data: copiedRows } = await supabase
      .from('user_copied_positions')
      .select('status, pnl_usd')
      .eq('user_id', user.id)
      .in('asset_class', assetClasses)

    if (copiedRows?.length) {
      const openCopied = copiedRows.filter(r => r.status === 'open')
      const closedCopied = copiedRows.filter(r => r.status === 'closed')
      const realized = closedCopied.reduce((s, r) => s + ((r.pnl_usd as number) ?? 0), 0)
      const unrealized = openCopied.reduce((s, r) => s + ((r.pnl_usd as number) ?? 0), 0)
      const wins = closedCopied.filter(r => ((r.pnl_usd as number) ?? 0) > 0)
      const losses = closedCopied.filter(r => ((r.pnl_usd as number) ?? 0) <= 0)
      const byStrategy: PaperSummary['byStrategy'] = {}

      for (const p of closedCopied) {
        const k = 'legacy'
        if (!byStrategy[k]) byStrategy[k] = { pnlUsd: 0, trades: 0, winRate: null }
        byStrategy[k].pnlUsd += (p.pnl_usd as number) ?? 0
        byStrategy[k].trades++
      }
      for (const [k, v] of Object.entries(byStrategy)) {
        const stratWins = closedCopied.filter(
          p => k === 'legacy' && ((p.pnl_usd as number) ?? 0) > 0
        ).length
        byStrategy[k].winRate = v.trades > 0 ? stratWins / v.trades : null
      }

      return NextResponse.json({
        totalRealizedPnlUsd: realized,
        totalUnrealizedPnlUsd: unrealized,
        totalPnlUsd: realized + unrealized,
        closedTrades: closedCopied.length,
        openPositions: openCopied.length,
        winRate: closedCopied.length > 0 ? wins.length / closedCopied.length : null,
        avgWinUsd: wins.length > 0 ? wins.reduce((s, p) => s + ((p.pnl_usd as number) ?? 0), 0) / wins.length : null,
        avgLossUsd: losses.length > 0 ? losses.reduce((s, p) => s + ((p.pnl_usd as number) ?? 0), 0) / losses.length : null,
        byStrategy,
      } satisfies PaperSummary)
    }
  }

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
