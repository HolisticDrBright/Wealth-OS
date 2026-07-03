'use server'

/**
 * Strategy leaderboard metrics (UI brief widget 5) — FreqUI metric set
 * computed from CLOSED paper positions: net expectancy, annualized return,
 * Sortino, Calmar, SQN. All net of modeled fill costs (PaperBroker applies
 * slippage on entry and exit).
 */

import { createClient } from '@/lib/supabase/server'

export interface StrategyMetrics {
  strategyKey: string
  trades: number
  /** Mean realized return per trade (fraction, net of modeled costs). */
  netExpectancyPct: number
  /** Annualized return approximation: expectancy × trades-per-year. */
  annualizedPct: number
  sortino: number | null
  calmar: number | null
  /** System Quality Number: (mean/std) × √n on per-trade returns. */
  sqn: number | null
  maxDrawdownPct: number
  winRatePct: number
}

interface ClosedRow {
  strategy_key: string
  closed_at: string | null
  opened_at: string | null
  realized_pnl_pct: number | null
}

/** Pure metric math — exported for tests. */
export async function computeMetrics(
  rows: Array<{ strategyKey: string; closedAt: string; returnPct: number }>
): Promise<StrategyMetrics[]> {
  const byStrategy = new Map<string, Array<{ closedAt: string; returnPct: number }>>()
  for (const r of rows) {
    if (!byStrategy.has(r.strategyKey)) byStrategy.set(r.strategyKey, [])
    byStrategy.get(r.strategyKey)!.push({ closedAt: r.closedAt, returnPct: r.returnPct })
  }

  const out: StrategyMetrics[] = []
  for (const [strategyKey, trades] of byStrategy) {
    trades.sort((a, b) => a.closedAt.localeCompare(b.closedAt))
    const n = trades.length
    const rets = trades.map(t => t.returnPct)
    const mean = rets.reduce((s, r) => s + r, 0) / n
    const wins = rets.filter(r => r > 0).length

    // Span for annualization: first to last close (≥ 1 day to avoid blowups)
    const spanDays = Math.max(
      1,
      (new Date(trades[n - 1].closedAt).getTime() - new Date(trades[0].closedAt).getTime()) / 86_400_000
    )
    const tradesPerYear = (n / spanDays) * 365
    const annualized = mean * tradesPerYear

    // Downside deviation (Sortino denominator)
    const downside = rets.filter(r => r < 0)
    const downsideDev = downside.length
      ? Math.sqrt(downside.reduce((s, r) => s + r * r, 0) / downside.length)
      : null
    const sortino = downsideDev && downsideDev > 0
      ? (mean / downsideDev) * Math.sqrt(Math.min(tradesPerYear, 365))
      : null

    // Max drawdown on the cumulative per-trade equity curve
    let equity = 1
    let peak = 1
    let maxDd = 0
    for (const r of rets) {
      equity *= 1 + r
      peak = Math.max(peak, equity)
      maxDd = Math.max(maxDd, (peak - equity) / peak)
    }
    const calmar = maxDd > 0 ? annualized / maxDd : null

    const variance = n > 1 ? rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1) : 0
    const std = Math.sqrt(variance)
    const sqn = std > 0 ? (mean / std) * Math.sqrt(n) : null

    out.push({
      strategyKey,
      trades: n,
      netExpectancyPct: Math.round(mean * 10_000) / 100,
      annualizedPct: Math.round(annualized * 10_000) / 100,
      sortino: sortino != null ? Math.round(sortino * 100) / 100 : null,
      calmar: calmar != null ? Math.round(calmar * 100) / 100 : null,
      sqn: sqn != null ? Math.round(sqn * 100) / 100 : null,
      maxDrawdownPct: Math.round(maxDd * 10_000) / 100,
      winRatePct: Math.round((wins / n) * 10_000) / 100,
    })
  }
  return out.sort((a, b) => b.netExpectancyPct - a.netExpectancyPct)
}

export async function getStrategyMetrics(): Promise<StrategyMetrics[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('paper_positions')
    .select('strategy_key, closed_at, opened_at, realized_pnl_pct')
    .eq('user_id', user.id)
    .eq('status', 'closed')
    .limit(5000)

  const rows = ((data ?? []) as ClosedRow[])
    .filter(r => r.closed_at && r.realized_pnl_pct != null)
    .map(r => ({
      strategyKey: r.strategy_key,
      closedAt: r.closed_at!,
      returnPct: r.realized_pnl_pct!,
    }))

  return computeMetrics(rows)
}
