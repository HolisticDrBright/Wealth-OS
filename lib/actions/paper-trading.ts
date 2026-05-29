'use server'

/**
 * Per-user paper-trading reads for the Command Center and paper-trading views.
 * All queries are user-scoped and read-only. Empty tables yield empty results
 * (and honest empty states in the UI) — never fabricated positions.
 */

import { createClient } from '@/lib/supabase/server'
import { toDisplayName } from '@/lib/strategies/strategy-display'

export interface PaperPosition {
  id: string
  strategyKey: string
  strategyLabel: string
  symbol: string
  assetClass: string
  direction: string
  notionalUsd: number
  entryPrice: number | null
  currentPrice: number | null
  unrealizedPnlUsd: number
  unrealizedPnlPct: number
  openedAt: string
  status: string
}

export interface PaperTradingSummary {
  openCount: number
  closedCount: number
  realizedPnlUsd: number
  unrealizedPnlUsd: number
  winRate: number | null
  hasData: boolean
}

interface PaperRow {
  id: string
  strategy_key: string | null
  symbol: string | null
  asset_class: string | null
  direction: string | null
  notional_usd: number | null
  entry_price: number | null
  current_price: number | null
  unrealized_pnl_usd: number | null
  unrealized_pnl_pct: number | null
  realized_pnl_usd: number | null
  opened_at: string | null
  status: string | null
}

export async function getActivePaperPositions(limit = 50): Promise<PaperPosition[]> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const { data, error } = await supabase
      .from('paper_positions')
      .select('id, strategy_key, symbol, asset_class, direction, notional_usd, entry_price, current_price, unrealized_pnl_usd, unrealized_pnl_pct, opened_at, status')
      .eq('user_id', user.id)
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .limit(limit)

    if (error || !data) return []

    return (data as PaperRow[]).map(r => ({
      id: r.id,
      strategyKey: r.strategy_key ?? 'unknown',
      strategyLabel: r.strategy_key ? toDisplayName(r.strategy_key) : 'Unknown',
      symbol: r.symbol ?? '—',
      assetClass: r.asset_class ?? 'multi-asset',
      direction: r.direction ?? 'long',
      notionalUsd: r.notional_usd ?? 0,
      entryPrice: r.entry_price,
      currentPrice: r.current_price,
      unrealizedPnlUsd: r.unrealized_pnl_usd ?? 0,
      unrealizedPnlPct: r.unrealized_pnl_pct ?? 0,
      openedAt: r.opened_at ?? new Date().toISOString(),
      status: r.status ?? 'open',
    }))
  } catch {
    return []
  }
}

export async function getPaperTradingSummary(): Promise<PaperTradingSummary> {
  const empty: PaperTradingSummary = {
    openCount: 0, closedCount: 0, realizedPnlUsd: 0, unrealizedPnlUsd: 0, winRate: null, hasData: false,
  }
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return empty

    const { data, error } = await supabase
      .from('paper_positions')
      .select('status, unrealized_pnl_usd, realized_pnl_usd')
      .eq('user_id', user.id)

    if (error || !data || data.length === 0) return empty

    const rows = data as Pick<PaperRow, 'status' | 'unrealized_pnl_usd' | 'realized_pnl_usd'>[]
    const open = rows.filter(r => r.status === 'open')
    const closed = rows.filter(r => r.status !== 'open')
    const realized = closed.reduce((s, r) => s + (r.realized_pnl_usd ?? 0), 0)
    const unrealized = open.reduce((s, r) => s + (r.unrealized_pnl_usd ?? 0), 0)
    const wins = closed.filter(r => (r.realized_pnl_usd ?? 0) > 0).length

    return {
      openCount: open.length,
      closedCount: closed.length,
      realizedPnlUsd: realized,
      unrealizedPnlUsd: unrealized,
      winRate: closed.length > 0 ? wins / closed.length : null,
      hasData: true,
    }
  } catch {
    return empty
  }
}
