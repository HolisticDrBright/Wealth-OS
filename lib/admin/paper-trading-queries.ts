import type { SupabaseClient } from '@supabase/supabase-js'

export interface TradesByStrategy {
  strategy_key: string
  trade_count: number
  wins: number
  losses: number
  total_pnl_usd: number
}

export interface PnlByStrategy {
  strategy_key: string
  realized_pnl_usd: number
  avg_pnl_pct: number
  trade_count: number
}

export interface OpenPositionRow {
  id: string
  user_id: string
  strategy_key: string
  symbol: string
  asset_class: string
  direction: string
  notional_usd: number
  entry_price: number
  opened_at: string
}

export interface ExitReasonRow {
  close_reason: string
  count: number
}

/** a. Trades fired per strategy in the last 7 days */
export async function getTradesByStrategy(supabase: SupabaseClient): Promise<TradesByStrategy[]> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('paper_positions') as any)
    .select('strategy_key, realized_pnl_usd')
    .eq('status', 'closed')
    .gte('closed_at', since)

  if (error || !data) return []

  const map = new Map<string, TradesByStrategy>()
  for (const row of data as { strategy_key: string; realized_pnl_usd: number | null }[]) {
    const key = row.strategy_key
    if (!map.has(key)) map.set(key, { strategy_key: key, trade_count: 0, wins: 0, losses: 0, total_pnl_usd: 0 })
    const entry = map.get(key)!
    entry.trade_count++
    const pnl = row.realized_pnl_usd ?? 0
    if (pnl >= 0) entry.wins++
    else entry.losses++
    entry.total_pnl_usd += pnl
  }

  return Array.from(map.values()).sort((a, b) => b.trade_count - a.trade_count)
}

/** b. P&L by strategy in the last 7 days */
export async function getPnlByStrategy(supabase: SupabaseClient): Promise<PnlByStrategy[]> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('paper_positions') as any)
    .select('strategy_key, realized_pnl_usd, realized_pnl_pct')
    .eq('status', 'closed')
    .gte('closed_at', since)

  if (error || !data) return []

  const map = new Map<string, { pnl: number; pct: number[]; count: number }>()
  for (const row of data as { strategy_key: string; realized_pnl_usd: number | null; realized_pnl_pct: number | null }[]) {
    const key = row.strategy_key
    if (!map.has(key)) map.set(key, { pnl: 0, pct: [], count: 0 })
    const entry = map.get(key)!
    entry.pnl += row.realized_pnl_usd ?? 0
    if (row.realized_pnl_pct != null) entry.pct.push(row.realized_pnl_pct)
    entry.count++
  }

  return Array.from(map.entries())
    .map(([strategy_key, v]) => ({
      strategy_key,
      realized_pnl_usd: v.pnl,
      avg_pnl_pct: v.pct.length > 0 ? v.pct.reduce((s, x) => s + x, 0) / v.pct.length : 0,
      trade_count: v.count,
    }))
    .sort((a, b) => b.realized_pnl_usd - a.realized_pnl_usd)
}

/** c. Open positions snapshot */
export async function getOpenPositions(supabase: SupabaseClient): Promise<OpenPositionRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('paper_positions') as any)
    .select('id, user_id, strategy_key, symbol, asset_class, direction, notional_usd, entry_price, opened_at')
    .eq('status', 'open')
    .order('opened_at', { ascending: false })

  if (error || !data) return []
  return data as OpenPositionRow[]
}

/** d. Exit-reason breakdown for the last 7 days */
export async function getExitReasonBreakdown(supabase: SupabaseClient): Promise<ExitReasonRow[]> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('paper_positions') as any)
    .select('close_reason')
    .eq('status', 'closed')
    .gte('closed_at', since)

  if (error || !data) return []

  const counts = new Map<string, number>()
  for (const row of data as { close_reason: string | null }[]) {
    const reason = row.close_reason ?? 'unknown'
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .map(([close_reason, count]) => ({ close_reason, count }))
    .sort((a, b) => b.count - a.count)
}
