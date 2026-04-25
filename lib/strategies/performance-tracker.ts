/**
 * Paper-trade performance tracker.
 *
 * Records simulated trades and computes rolling Sharpe ratio, win rate,
 * and PnL per strategy. Used for the Tier 1 → Tier 2 gate:
 *   Sharpe > 1.5 over 14 days → unlock Tier 2 deployment.
 *
 * Trades are stored in the `strategy_paper_trades` table.
 * Sharpe is computed over daily returns using a 0% risk-free rate.
 */

import { createAdminClient } from '@/lib/supabase/admin'

export interface PaperTrade {
  strategy_id: string
  symbol: string
  side: 'buy' | 'sell'
  entry_price: number
  size_usd: number
  entry_time: string
  exit_price?: number
  exit_time?: string
  pnl_usd?: number
  pnl_pct?: number
  status: 'open' | 'closed'
  signal_strength: number
  signal_score?: number
  metadata?: Record<string, unknown>
}

export interface StrategyPerformance {
  strategy_id: string
  trade_count: number
  win_rate: number
  avg_pnl_pct: number
  total_pnl_usd: number
  sharpe_ratio: number
  max_drawdown_pct: number
  days_tracked: number
  /** True when Sharpe > 1.5 over >= 14 days of trades */
  tier_gate_passed: boolean
}

// ─── Write ─────────────────────────────────────────────────────────────────────

/** Open a new paper trade. */
export async function openPaperTrade(trade: Omit<PaperTrade, 'status' | 'exit_price' | 'exit_time' | 'pnl_usd' | 'pnl_pct'>): Promise<string | null> {
  try {
    const db = createAdminClient()
    const { data, error } = await db.from('strategy_paper_trades').insert({
      ...trade,
      status: 'open',
    }).select('id').single()
    if (error) { console.warn('[PaperTracker] openPaperTrade failed:', error.message); return null }
    return data?.id ?? null
  } catch (err) {
    console.warn('[PaperTracker] openPaperTrade error:', err)
    return null
  }
}

/** Close an open paper trade and record PnL. */
export async function closePaperTrade(
  tradeId: string,
  exitPrice: number,
  exitTime = new Date().toISOString()
): Promise<void> {
  try {
    const db = createAdminClient()
    const { data: trade } = await db.from('strategy_paper_trades').select('*').eq('id', tradeId).single()
    if (!trade) return

    const direction = trade.side === 'buy' ? 1 : -1
    const pnl_pct = direction * (exitPrice - trade.entry_price) / trade.entry_price
    const pnl_usd = pnl_pct * trade.size_usd

    await db.from('strategy_paper_trades').update({
      exit_price: exitPrice,
      exit_time: exitTime,
      pnl_usd,
      pnl_pct,
      status: 'closed',
    }).eq('id', tradeId)
  } catch (err) {
    console.warn('[PaperTracker] closePaperTrade error:', err)
  }
}

// ─── Read / Analytics ──────────────────────────────────────────────────────────

/** Compute rolling Sharpe ratio from an array of daily return percentages. */
function computeSharpe(dailyReturns: number[]): number {
  if (dailyReturns.length < 2) return 0
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
  const variance = dailyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / dailyReturns.length
  const stdDev = Math.sqrt(variance)
  if (stdDev === 0) return 0
  return (mean / stdDev) * Math.sqrt(252)  // annualised
}

/** Compute max drawdown from equity curve. */
function computeMaxDrawdown(returns: number[]): number {
  let peak = 1
  let equity = 1
  let maxDD = 0
  for (const r of returns) {
    equity *= 1 + r
    if (equity > peak) peak = equity
    const dd = (peak - equity) / peak
    if (dd > maxDD) maxDD = dd
  }
  return maxDD
}

/** Get performance summary for a strategy over the last N days. */
export async function getStrategyPerformance(
  strategyId: string,
  days = 14
): Promise<StrategyPerformance> {
  const empty: StrategyPerformance = {
    strategy_id: strategyId, trade_count: 0, win_rate: 0, avg_pnl_pct: 0,
    total_pnl_usd: 0, sharpe_ratio: 0, max_drawdown_pct: 0, days_tracked: 0,
    tier_gate_passed: false,
  }

  try {
    const db = createAdminClient()
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    const { data: trades } = await db
      .from('strategy_paper_trades')
      .select('*')
      .eq('strategy_id', strategyId)
      .eq('status', 'closed')
      .gte('exit_time', since)
      .order('exit_time', { ascending: true })

    if (!trades || trades.length === 0) return empty

    const pnlPcts: number[] = trades.map((t: { pnl_pct: number }) => t.pnl_pct ?? 0)
    const wins = pnlPcts.filter(p => p > 0).length

    // Build daily return series for Sharpe
    const byDay = new Map<string, number[]>()
    for (const t of trades) {
      const day = (t.exit_time as string).split('T')[0]
      if (!byDay.has(day)) byDay.set(day, [])
      byDay.get(day)!.push(t.pnl_pct ?? 0)
    }
    const dailyReturns = Array.from(byDay.values()).map(
      dayPnls => dayPnls.reduce((a, b) => a + b, 0)
    )

    const sharpe = computeSharpe(dailyReturns)
    const maxDrawdown = computeMaxDrawdown(pnlPcts)
    const firstDay = new Date(trades[0].entry_time as string)
    const daysTracked = Math.ceil((Date.now() - firstDay.getTime()) / 86400000)

    return {
      strategy_id: strategyId,
      trade_count: trades.length,
      win_rate: wins / trades.length,
      avg_pnl_pct: pnlPcts.reduce((a, b) => a + b, 0) / pnlPcts.length,
      total_pnl_usd: trades.reduce((a: number, t: { pnl_usd: number }) => a + (t.pnl_usd ?? 0), 0),
      sharpe_ratio: sharpe,
      max_drawdown_pct: maxDrawdown,
      days_tracked: daysTracked,
      tier_gate_passed: sharpe >= 1.5 && daysTracked >= 14,
    }
  } catch (err) {
    console.warn('[PaperTracker] getStrategyPerformance error:', err)
    return empty
  }
}

/** Get performance for all Tier 1 strategies. */
export async function getTier1GateStatus(): Promise<{
  all_passed: boolean
  strategies: StrategyPerformance[]
}> {
  const TIER1_IDS = [
    'polymarket_wallet_copy',
    'polymarket_info_lag',
    'autopilot_congressional',
    'dca_halving',
    'funding_basis_arb',
  ]

  const strategies = await Promise.all(TIER1_IDS.map(id => getStrategyPerformance(id, 14)))
  const all_passed = strategies.every(s => s.tier_gate_passed)
  return { all_passed, strategies }
}
