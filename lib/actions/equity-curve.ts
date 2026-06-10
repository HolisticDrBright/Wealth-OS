'use server'

/**
 * Paper portfolio equity curve — cumulative realized P&L by day from closed
 * positions, with the Shadow Portfolio overlaid so "what we took" vs "what we
 * declined" is one chart. Honest data only: built entirely from recorded
 * closes; the final point adds current unrealized P&L of open positions.
 */

import { createClient } from '@/lib/supabase/server'

export interface EquityPoint {
  /** YYYY-MM-DD */
  date: string
  /** Cumulative realized paper P&L through this day (USD). */
  realUsd: number
  /** Cumulative realized shadow (rejected trades) P&L through this day. */
  shadowUsd: number
}

export interface EquityCurveView {
  points: EquityPoint[]
  totalRealizedUsd: number
  totalUnrealizedUsd: number
  totalPnlUsd: number
  closedTrades: number
  winRate: number | null
}

interface CloseRow { closed_at: string | null; realized_pnl_usd: number | null }
interface ShadowCloseRow { resolved_at: string | null; realized_pnl_usd: number | null }
interface OpenRow { unrealized_pnl_usd: number | null }

export async function getEquityCurve(): Promise<EquityCurveView | null> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const [{ data: closed }, { data: shadowClosed }, { data: open }] = await Promise.all([
      supabase
        .from('paper_positions')
        .select('closed_at, realized_pnl_usd')
        .eq('user_id', user.id)
        .eq('status', 'closed')
        .order('closed_at', { ascending: true })
        .limit(5000),
      supabase
        .from('shadow_positions')
        .select('resolved_at, realized_pnl_usd')
        .eq('user_id', user.id)
        .eq('status', 'closed')
        .order('resolved_at', { ascending: true })
        .limit(5000),
      supabase
        .from('paper_positions')
        .select('unrealized_pnl_usd')
        .eq('user_id', user.id)
        .eq('status', 'open'),
    ])

    const realByDay = new Map<string, number>()
    let totalRealizedUsd = 0
    let wins = 0
    let losses = 0
    for (const row of (closed ?? []) as CloseRow[]) {
      if (!row.closed_at) continue
      const day = row.closed_at.slice(0, 10)
      const pnl = row.realized_pnl_usd ?? 0
      realByDay.set(day, (realByDay.get(day) ?? 0) + pnl)
      totalRealizedUsd += pnl
      if (pnl > 0) wins++
      else losses++
    }

    const shadowByDay = new Map<string, number>()
    for (const row of (shadowClosed ?? []) as ShadowCloseRow[]) {
      if (!row.resolved_at) continue
      const day = row.resolved_at.slice(0, 10)
      shadowByDay.set(day, (shadowByDay.get(day) ?? 0) + (row.realized_pnl_usd ?? 0))
    }

    const days = [...new Set([...realByDay.keys(), ...shadowByDay.keys()])].sort()
    const points: EquityPoint[] = []
    let realCum = 0
    let shadowCum = 0
    for (const day of days) {
      realCum += realByDay.get(day) ?? 0
      shadowCum += shadowByDay.get(day) ?? 0
      points.push({
        date: day,
        realUsd: Math.round(realCum * 100) / 100,
        shadowUsd: Math.round(shadowCum * 100) / 100,
      })
    }

    const totalUnrealizedUsd = ((open ?? []) as OpenRow[])
      .reduce((s, r) => s + (r.unrealized_pnl_usd ?? 0), 0)

    const closedTrades = wins + losses

    return {
      points,
      totalRealizedUsd: Math.round(totalRealizedUsd * 100) / 100,
      totalUnrealizedUsd: Math.round(totalUnrealizedUsd * 100) / 100,
      totalPnlUsd: Math.round((totalRealizedUsd + totalUnrealizedUsd) * 100) / 100,
      closedTrades,
      winRate: closedTrades > 0 ? wins / closedTrades : null,
    }
  } catch {
    return null
  }
}
