'use server'

import { createClient } from '@/lib/supabase/server'
import { toDisplayName } from '@/lib/strategies/strategy-display'

export interface ShadowPosition {
  id: string
  strategyKey: string
  strategyLabel: string
  symbol: string
  assetClass: string
  direction: 'long' | 'short'
  wouldHavePrice: number
  wouldHaveNotional: number
  skipReason: string
  skipDetail: string | null
  status: 'open' | 'closed'
  currentPrice: number | null
  exitPrice: number | null
  unrealizedPnlUsd: number | null
  unrealizedPnlPct: number | null
  realizedPnlUsd: number | null
  realizedPnlPct: number | null
  exitReason: string | null
  createdAt: string
  resolvedAt: string | null
}

export interface ShadowPortfolioSummary {
  totalShadowPnlUsd: number
  totalRealPnlUsd: number
  openShadowPositions: number
  closedShadowPositions: number
  shadowWinRate: number | null
  realWinRate: number | null
  shadowAvgReturnPct: number | null
  realAvgReturnPct: number | null
  topSkipReason: string | null
  positions: ShadowPosition[]
}

interface ShadowRow {
  id: string
  strategy_key: string
  symbol: string
  asset_class: string
  direction: string
  would_have_price: number
  would_have_notional: number
  skip_reason: string
  skip_detail: string | null
  status: string
  current_price: number | null
  exit_price: number | null
  unrealized_pnl_usd: number | null
  unrealized_pnl_pct: number | null
  realized_pnl_usd: number | null
  realized_pnl_pct: number | null
  exit_reason: string | null
  created_at: string
  resolved_at: string | null
}

interface RealPositionRow {
  realized_pnl_usd: number | null
  unrealized_pnl_usd: number | null
  status: string
}

function mapRow(row: ShadowRow): ShadowPosition {
  return {
    id: row.id,
    strategyKey: row.strategy_key,
    strategyLabel: toDisplayName(row.strategy_key),
    symbol: row.symbol,
    assetClass: row.asset_class,
    direction: row.direction as 'long' | 'short',
    wouldHavePrice: row.would_have_price,
    wouldHaveNotional: row.would_have_notional,
    skipReason: row.skip_reason,
    skipDetail: row.skip_detail,
    status: row.status as 'open' | 'closed',
    currentPrice: row.current_price,
    exitPrice: row.exit_price,
    unrealizedPnlUsd: row.unrealized_pnl_usd,
    unrealizedPnlPct: row.unrealized_pnl_pct,
    realizedPnlUsd: row.realized_pnl_usd,
    realizedPnlPct: row.realized_pnl_usd !== null && row.would_have_notional > 0
      ? row.realized_pnl_usd / row.would_have_notional
      : row.realized_pnl_pct,
    exitReason: row.exit_reason,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  }
}

export async function getShadowPortfolio(limit = 50): Promise<ShadowPortfolioSummary> {
  const empty: ShadowPortfolioSummary = {
    totalShadowPnlUsd: 0,
    totalRealPnlUsd: 0,
    openShadowPositions: 0,
    closedShadowPositions: 0,
    shadowWinRate: null,
    realWinRate: null,
    shadowAvgReturnPct: null,
    realAvgReturnPct: null,
    topSkipReason: null,
    positions: [],
  }

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return empty

    const [{ data: shadowData }, { data: realData }] = await Promise.all([
      supabase
        .from('shadow_positions')
        .select('id, strategy_key, symbol, asset_class, direction, would_have_price, would_have_notional, skip_reason, skip_detail, status, current_price, exit_price, unrealized_pnl_usd, unrealized_pnl_pct, realized_pnl_usd, realized_pnl_pct, exit_reason, created_at, resolved_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(limit),
      supabase
        .from('paper_positions')
        .select('realized_pnl_usd, unrealized_pnl_usd, status')
        .eq('user_id', user.id),
    ])

    const positions = ((shadowData ?? []) as ShadowRow[]).map(mapRow)

    // Shadow P&L totals
    let totalShadowPnlUsd = 0
    let openCount = 0
    let closedCount = 0
    let shadowWins = 0
    let shadowLosses = 0
    const shadowReturns: number[] = []

    for (const p of positions) {
      if (p.status === 'open') {
        openCount++
        totalShadowPnlUsd += p.unrealizedPnlUsd ?? 0
      } else {
        closedCount++
        const pnl = p.realizedPnlUsd ?? 0
        totalShadowPnlUsd += pnl
        if (pnl > 0) shadowWins++
        else shadowLosses++
        if (p.realizedPnlPct != null) shadowReturns.push(p.realizedPnlPct)
      }
    }

    // Real portfolio P&L
    let totalRealPnlUsd = 0
    let realWins = 0
    let realLosses = 0
    const realReturns: number[] = []
    const realPositions = (realData ?? []) as RealPositionRow[]

    for (const p of realPositions) {
      if (p.status === 'open') {
        totalRealPnlUsd += p.unrealized_pnl_usd ?? 0
      } else {
        const pnl = p.realized_pnl_usd ?? 0
        totalRealPnlUsd += pnl
        if (pnl > 0) realWins++
        else realLosses++
      }
    }

    // Top skip reason by frequency
    const reasonCounts: Record<string, number> = {}
    for (const p of positions) {
      reasonCounts[p.skipReason] = (reasonCounts[p.skipReason] ?? 0) + 1
    }
    const topSkipReason = Object.keys(reasonCounts).sort((a, b) => reasonCounts[b] - reasonCounts[a])[0] ?? null

    const shadowTotal = shadowWins + shadowLosses
    const realTotal = realWins + realLosses

    return {
      totalShadowPnlUsd,
      totalRealPnlUsd,
      openShadowPositions: openCount,
      closedShadowPositions: closedCount,
      shadowWinRate: shadowTotal > 0 ? shadowWins / shadowTotal : null,
      realWinRate: realTotal > 0 ? realWins / realTotal : null,
      shadowAvgReturnPct: shadowReturns.length > 0 ? shadowReturns.reduce((a, b) => a + b, 0) / shadowReturns.length : null,
      realAvgReturnPct: realReturns.length > 0 ? realReturns.reduce((a, b) => a + b, 0) / realReturns.length : null,
      topSkipReason,
      positions,
    }
  } catch {
    return empty
  }
}
