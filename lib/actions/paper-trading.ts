'use server'

/**
 * Per-user paper-trading reads for the Command Center and paper-trading views.
 * All queries are user-scoped and read-only. Empty tables yield empty results
 * (and honest empty states in the UI) — never fabricated positions.
 */

import { createClient } from '@/lib/supabase/server'
import { toDisplayName } from '@/lib/strategies/strategy-display'
import type { SkipCounts, SkippedDetail } from '@/lib/paper-trading/types'

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

export interface PaperRunView {
  runAt: string
  strategiesRun: number
  opportunitiesFound: number
  positionsOpened: number
  positionsClosed: number
  skipped: SkipCounts
  topSkipReason: string | null
  totalSkipped: number
  plainEnglish: string
  errors: string[]
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

function buildPlainEnglish(
  opportunitiesFound: number,
  positionsOpened: number,
  positionsClosed: number,
  skipped: SkipCounts,
): string {
  if (opportunitiesFound === 0) return 'No actionable signals found this run.'
  const reasons: string[] = []
  if (skipped.alreadyOpen > 0) reasons.push(`${skipped.alreadyOpen} already held`)
  if (skipped.missingPrice > 0) reasons.push(`${skipped.missingPrice} had no live price`)
  if (skipped.expiredMarket + skipped.resolvedMarket > 0) {
    reasons.push(`${skipped.expiredMarket + skipped.resolvedMarket} Polymarket contracts expired`)
  }
  if (skipped.venueBlocked > 0) reasons.push(`${skipped.venueBlocked} venue-blocked`)
  const blocked = skipped.riskBlocked + skipped.profileBlocked
  if (blocked > 0) reasons.push(`${blocked} blocked by rules`)

  if (positionsOpened === 0 && positionsClosed === 0) {
    return reasons.length > 0
      ? `Found ${opportunitiesFound} opportunities, opened none — ${reasons.join(', ')}.`
      : `Found ${opportunitiesFound} opportunities, none executed.`
  }
  const lines: string[] = []
  if (positionsOpened > 0) lines.push(`Opened ${positionsOpened} new position${positionsOpened > 1 ? 's' : ''}.`)
  if (positionsClosed > 0) lines.push(`Closed ${positionsClosed} position${positionsClosed > 1 ? 's' : ''}.`)
  if (reasons.length > 0) lines.push(`Skipped: ${reasons.join(', ')}.`)
  return lines.join(' ')
}

function topSkipReason(s: SkipCounts): string | null {
  const entries = [
    ['Already open', s.alreadyOpen],
    ['No price', s.missingPrice],
    ['Expired market', s.expiredMarket],
    ['Resolved market', s.resolvedMarket],
    ['Risk blocked', s.riskBlocked],
    ['Profile blocked', s.profileBlocked],
    ['Venue blocked', s.venueBlocked],
    ['Cap blocked', s.positionCapBlocked],
    ['No size', s.noSize],
  ] as [string, number][]
  const top = entries.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0]
  return top ? `${top[0]} (${top[1]})` : null
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

export async function getLastPaperRun(): Promise<PaperRunView | null> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data, error } = await supabase
      .from('paper_trade_runs')
      .select('run_at, strategies_run, opportunities_found, positions_opened, positions_closed, skipped, errors')
      .eq('user_id', user.id)
      .order('run_at', { ascending: false })
      .limit(1)
      .single()

    if (error || !data) return null

    const row = data as {
      run_at: string
      strategies_run: number
      opportunities_found: number
      positions_opened: number
      positions_closed: number
      skipped: SkipCounts
      errors: string[]
    }

    const skipped = (row.skipped ?? {}) as SkipCounts
    const totalSkipped = Object.values(skipped).reduce((s: number, v: unknown) => s + (typeof v === 'number' ? v : 0), 0)

    return {
      runAt: row.run_at,
      strategiesRun: row.strategies_run ?? 0,
      opportunitiesFound: row.opportunities_found ?? 0,
      positionsOpened: row.positions_opened ?? 0,
      positionsClosed: row.positions_closed ?? 0,
      skipped,
      topSkipReason: topSkipReason(skipped),
      totalSkipped,
      plainEnglish: buildPlainEnglish(
        row.opportunities_found ?? 0,
        row.positions_opened ?? 0,
        row.positions_closed ?? 0,
        skipped,
      ),
      errors: (row.errors as string[]) ?? [],
    }
  } catch {
    return null
  }
}

export async function getPaperRunHistory(limit = 20): Promise<PaperRunView[]> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const { data, error } = await supabase
      .from('paper_trade_runs')
      .select('run_at, strategies_run, opportunities_found, positions_opened, positions_closed, skipped, errors')
      .eq('user_id', user.id)
      .order('run_at', { ascending: false })
      .limit(limit)

    if (error || !data) return []

    return (data as typeof data).map((row: Record<string, unknown>) => {
      const skipped = (row.skipped as SkipCounts) ?? {}
      const totalSkipped = Object.values(skipped).reduce((s: number, v: unknown) => s + (typeof v === 'number' ? v : 0), 0)
      return {
        runAt: row.run_at as string,
        strategiesRun: (row.strategies_run as number) ?? 0,
        opportunitiesFound: (row.opportunities_found as number) ?? 0,
        positionsOpened: (row.positions_opened as number) ?? 0,
        positionsClosed: (row.positions_closed as number) ?? 0,
        skipped,
        topSkipReason: topSkipReason(skipped),
        totalSkipped,
        plainEnglish: buildPlainEnglish(
          (row.opportunities_found as number) ?? 0,
          (row.positions_opened as number) ?? 0,
          (row.positions_closed as number) ?? 0,
          skipped,
        ),
        errors: (row.errors as string[]) ?? [],
      }
    })
  } catch {
    return []
  }
}
