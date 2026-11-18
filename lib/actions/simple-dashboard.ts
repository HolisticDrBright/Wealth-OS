'use server'

/**
 * Simple-mode dashboard data (Phase 3.2) — exactly four things, every number
 * sourced from existing tables and the existing historical return series:
 *  a. total value + change today + change since start (+ a value series),
 *  b. primary goal progress with an on-track verdict and expected date,
 *  c. "what happened this week" plain-English sentences,
 *  d. the Command Center's decisions list.
 * Plus the dollar risk line ("in a bad year this could fall about $X"),
 * derived from the same series the planning Monte Carlo uses.
 */

import { createClient } from '@/lib/supabase/server'
import { getEquityCurve } from '@/lib/actions/equity-curve'
import { getDecisionItems, type DecisionItem } from '@/lib/actions/command-center'
import { fetchSpxMonthlyReturns } from '@/lib/planning/market-returns'
import {
  medianOf, projectGoalMonths, addMonths, goalStatusOf, yearRangeUsd,
  badYearSetbackMonths, type GoalStatus, type YearRangeUsd,
} from '@/lib/planning/goal-projection'
import { generateWeeklySummary } from '@/lib/simple/weekly-summary'

export interface SimpleGoalView {
  id: string
  name: string
  targetAmountUsd: number
  targetDate: string | null
  monthlyContributionUsd: number
  savedUsd: number
  fraction: number
  status: GoalStatus
  /** yyyy-mm-dd, null when no honest estimate is possible right now. */
  expectedDate: string | null
  /** Months a bad year would push the goal back (null = unknown). */
  badYearSetbackMonths: number | null
}

export interface SimpleDashboardData {
  totalValueUsd: number
  todayChangeUsd: number
  sinceStartChangeUsd: number
  /** Daily total-value points for the chart (base assets + cumulative P&L). */
  valueSeries: Array<{ date: string; valueUsd: number }>
  goal: SimpleGoalView | null
  goalCount: number
  weekItems: string[]
  decisions: DecisionItem[]
  /** Good/typical/bad year in dollars for THIS portfolio (null = series unavailable). */
  yearRange: YearRangeUsd | null
  tradingHalted: boolean
}

export async function getSimpleDashboard(): Promise<SimpleDashboardData | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const todayUtc = new Date().toISOString().slice(0, 10)

  const [assetsRes, curve, decisions, returns, goalsRes, closesRes, opensRes, blocksRes, flagsRes] =
    await Promise.all([
      supabase.from('assets').select('current_value').eq('user_id', user.id),
      getEquityCurve().catch(() => null),
      getDecisionItems().catch(() => [] as DecisionItem[]),
      fetchSpxMonthlyReturns(),
      supabase
        .from('household_goals')
        .select('id, name, target_amount_usd, target_date, monthly_contribution_usd, status, household_id, households!inner(owner_user_id)')
        .eq('status', 'active')
        .eq('households.owner_user_id', user.id)
        .order('target_date', { ascending: true, nullsFirst: false }),
      supabase.from('paper_positions')
        .select('symbol, exit_reason, realized_pnl_usd, closed_at')
        .eq('user_id', user.id).eq('status', 'closed').gte('closed_at', weekAgo),
      supabase.from('paper_positions')
        .select('symbol, opened_at')
        .eq('user_id', user.id).gte('opened_at', weekAgo),
      supabase.from('audit_logs')
        .select('metadata, decided_at')
        .eq('user_id', user.id).eq('decision', 'block').gte('decided_at', weekAgo),
      supabase.from('system_flags').select('user_id, enabled').eq('key', 'trading_halted'),
    ])

  const baseAssetsUsd = ((assetsRes.data ?? []) as Array<{ current_value: number | null }>)
    .reduce((s, r) => s + (r.current_value ?? 0), 0)

  // a. Value + changes. "Since start" = all trading P&L (realized + open);
  // "today" = realized P&L closed today (the same derivation the risk strip
  // uses — there is no intraday asset price history to say more honestly).
  const sinceStartChangeUsd = curve?.totalPnlUsd ?? 0
  const totalValueUsd = baseAssetsUsd + sinceStartChangeUsd
  const todayChangeUsd = ((closesRes.data ?? []) as Array<{ closed_at: string | null; realized_pnl_usd: number | null }>)
    .filter(r => (r.closed_at ?? '').slice(0, 10) === todayUtc)
    .reduce((s, r) => s + (r.realized_pnl_usd ?? 0), 0)

  const valueSeries = (curve?.points ?? []).map(p => ({
    date: p.date,
    valueUsd: Math.round(baseAssetsUsd + p.realUsd),
  }))

  // b. Primary goal = earliest-dated active goal.
  const goals = (goalsRes.data ?? []) as Array<{
    id: string; name: string; target_amount_usd: number | string
    target_date: string | null; monthly_contribution_usd: number | string | null
  }>
  let goal: SimpleGoalView | null = null
  const medianMonthly = medianOf(returns)
  if (goals.length > 0) {
    const g = goals[0]
    const targetAmountUsd = Number(g.target_amount_usd)
    const monthlyContributionUsd = Number(g.monthly_contribution_usd ?? 0)
    // Saved-so-far = the whole portfolio works toward the primary goal.
    const savedUsd = Math.max(0, totalValueUsd)
    let expectedDate: string | null = null
    let setback: number | null = null
    if (medianMonthly != null) {
      const months = projectGoalMonths({
        currentUsd: savedUsd, monthlyContributionUsd, targetUsd: targetAmountUsd,
        monthlyReturn: medianMonthly,
      })
      if (months != null) expectedDate = addMonths(new Date().toISOString(), months)
      const range = yearRangeUsd(Math.max(1, savedUsd), returns)
      if (range) {
        setback = badYearSetbackMonths({
          currentUsd: savedUsd, monthlyContributionUsd, targetUsd: targetAmountUsd,
          monthlyReturn: medianMonthly, badYearUsd: range.badYearUsd,
        })
      }
    }
    goal = {
      id: g.id, name: g.name, targetAmountUsd,
      targetDate: g.target_date, monthlyContributionUsd,
      savedUsd: Math.round(savedUsd),
      fraction: targetAmountUsd > 0 ? Math.min(1, savedUsd / targetAmountUsd) : 0,
      status: goalStatusOf(expectedDate, g.target_date),
      expectedDate,
      badYearSetbackMonths: setback,
    }
  }

  // c. Weekly sentences from real events only.
  const flags = (flagsRes.data ?? []) as Array<{ user_id: string | null; enabled: boolean }>
  const tradingHalted = flags.some(f => f.enabled && (f.user_id === null || f.user_id === user.id))
  const weekItems = generateWeeklySummary({
    closes: ((closesRes.data ?? []) as Array<{ symbol: string; exit_reason: string | null; realized_pnl_usd: number | null }>)
      .map(r => ({ symbol: r.symbol, exitReason: r.exit_reason, pnlUsd: r.realized_pnl_usd ?? 0 })),
    opens: ((opensRes.data ?? []) as Array<{ symbol: string }>).map(r => ({ symbol: r.symbol })),
    blocked: ((blocksRes.data ?? []) as Array<{ metadata: Record<string, unknown> | null }>)
      .map(r => ({ reason: (r.metadata?.reason as string | undefined) ?? null })),
    halted: tradingHalted,
  })

  return {
    totalValueUsd: Math.round(totalValueUsd),
    todayChangeUsd: Math.round(todayChangeUsd * 100) / 100,
    sinceStartChangeUsd: Math.round(sinceStartChangeUsd * 100) / 100,
    valueSeries,
    goal,
    goalCount: goals.length,
    weekItems,
    decisions,
    yearRange: yearRangeUsd(Math.max(1, totalValueUsd), returns),
    tradingHalted,
  }
}
