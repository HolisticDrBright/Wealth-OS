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
import { fetchSpxMonthlyReturns, fetchMonthlyReturns } from '@/lib/planning/market-returns'
import {
  medianOf, projectGoalMonths, addMonths, goalStatusOf,
  badYearSetbackMonths, type GoalStatus, type YearRangeUsd,
} from '@/lib/planning/goal-projection'
import { generateWeeklySummary } from '@/lib/simple/weekly-summary'
import { LADDER_KEYS_FILTER } from '@/lib/allocation/sleeves'
import { loadLadder } from '@/lib/allocation/ladder-data'
import { tierMixForTotal, yearRangeForMix, badYearFraction } from '@/lib/allocation/bad-year'
import { CORE_FUNDS } from '@/lib/config/product-defaults'
import { loadNextDollarView, type NextDollarView } from '@/lib/advisory/next-dollar-data'

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
  /** Roadmap #1: where the next saved dollar should go (null if it can't be computed). */
  nextDollar: NextDollarView | null
}

interface FundRow {
  strategy_key: string; status: string; notional_usd: number | string | null
  quantity: number | string | null; exit_price: number | string | null
  opened_at: string | null; closed_at: string | null; metadata: Record<string, unknown> | null
}

/** This week's approved fund buys / sells (a split-off lot is a sale, not a buy). */
function fundMovesOf(rows: FundRow[], sinceIso: string) {
  let safetyBoughtUsd = 0, coreBoughtUsd = 0, coreSoldUsd = 0
  for (const r of rows) {
    if ((r.opened_at ?? '') >= sinceIso && !r.metadata?.split_from) {
      if (r.strategy_key === 'safety') safetyBoughtUsd += Number(r.notional_usd ?? 0)
      else coreBoughtUsd += Number(r.notional_usd ?? 0)
    }
    if (r.status === 'closed' && (r.closed_at ?? '') >= sinceIso && r.strategy_key === 'core') {
      coreSoldUsd += Number(r.quantity ?? 0) * Number(r.exit_price ?? 0)
    }
  }
  return { safetyBoughtUsd, coreBoughtUsd, coreSoldUsd }
}

export async function getSimpleDashboard(): Promise<SimpleDashboardData | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const todayUtc = new Date().toISOString().slice(0, 10)

  const [assetsRes, curve, decisions, returns, bondReturns, ladder, goalsRes, closesRes, opensRes, blocksRes, flagsRes, fundTradesRes] =
    await Promise.all([
      supabase.from('assets').select('current_value').eq('user_id', user.id),
      getEquityCurve().catch(() => null),
      getDecisionItems().catch(() => [] as DecisionItem[]),
      fetchSpxMonthlyReturns(),
      fetchMonthlyReturns(CORE_FUNDS.bonds),
      loadLadder(supabase, user.id).catch(() => null),
      supabase
        .from('household_goals')
        .select('id, name, target_amount_usd, target_date, monthly_contribution_usd, status, household_id, households!inner(owner_user_id)')
        .eq('status', 'active')
        .eq('households.owner_user_id', user.id)
        .order('target_date', { ascending: true, nullsFirst: false }),
      supabase.from('paper_positions')
        .select('symbol, exit_reason, realized_pnl_usd, closed_at').not('strategy_key', 'in', LADDER_KEYS_FILTER)
        .eq('user_id', user.id).eq('status', 'closed').gte('closed_at', weekAgo),
      supabase.from('paper_positions')
        .select('symbol, opened_at').not('strategy_key', 'in', LADDER_KEYS_FILTER)
        .eq('user_id', user.id).gte('opened_at', weekAgo),
      supabase.from('audit_logs')
        .select('metadata, decided_at')
        .eq('user_id', user.id).eq('decision', 'block').gte('decided_at', weekAgo),
      supabase.from('system_flags').select('user_id, enabled').eq('key', 'trading_halted'),
      // Fund moves from the position rows themselves (works whether or not the
      // paper_trades insert policy from migration 20260704m is applied).
      supabase.from('paper_positions')
        .select('strategy_key, status, notional_usd, quantity, exit_price, opened_at, closed_at, metadata')
        .in('strategy_key', ['core', 'safety']).eq('user_id', user.id)
        .or(`opened_at.gte.${weekAgo},closed_at.gte.${weekAgo}`),
    ])

  const baseAssetsUsd = ((assetsRes.data ?? []) as Array<{ current_value: number | null }>)
    .reduce((s, r) => s + (r.current_value ?? 0), 0)

  // a. Value + changes. "Since start" = all strategy P&L (realized + open)
  // plus the Core / Safety funds' P&L; deposits add value but are not gains.
  // "today" = realized P&L closed today (the same derivation the risk strip
  // uses — there is no intraday asset price history to say more honestly).
  const ladderPnlUsd = ladder?.ladderPnlUsd ?? 0
  const depositsUsd = ladder?.depositsUsd ?? 0
  const sinceStartChangeUsd = (curve?.totalPnlUsd ?? 0) + ladderPnlUsd
  const totalValueUsd = baseAssetsUsd + depositsUsd + sinceStartChangeUsd
  const todayChangeUsd = ((closesRes.data ?? []) as Array<{ closed_at: string | null; realized_pnl_usd: number | null }>)
    .filter(r => (r.closed_at ?? '').slice(0, 10) === todayUtc)
    .reduce((s, r) => s + (r.realized_pnl_usd ?? 0), 0)

  // The chart shows strategy P&L over time on top of the money you have; the
  // funds' gains land in today's point (their daily history isn't stored).
  const valueSeries = (curve?.points ?? []).map(p => ({
    date: p.date,
    valueUsd: Math.round(baseAssetsUsd + depositsUsd + p.realUsd),
  }))
  if (valueSeries.length > 0 && ladderPnlUsd !== 0) {
    valueSeries[valueSeries.length - 1] = {
      ...valueSeries[valueSeries.length - 1],
      valueUsd: valueSeries[valueSeries.length - 1].valueUsd + Math.round(ladderPnlUsd),
    }
  }

  // Bad-year dollars from the actual tier mix (Safety / Core stocks / Core bonds / rest).
  const mix = ladder
    ? tierMixForTotal(ladder, Math.max(0, totalValueUsd))
    : { cashUsd: 0, stocksUsd: 0, bondsUsd: 0, otherUsd: Math.max(1, totalValueUsd) }
  const yearRange = yearRangeForMix(mix, returns, bondReturns)
  const badFrac = badYearFraction(mix, returns, bondReturns)

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
      if (badFrac != null) {
        setback = badYearSetbackMonths({
          currentUsd: savedUsd, monthlyContributionUsd, targetUsd: targetAmountUsd,
          monthlyReturn: medianMonthly, badYearUsd: badFrac * savedUsd,
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
    fundMoves: fundMovesOf((fundTradesRes.data ?? []) as FundRow[], weekAgo),
  })

  const nextDollar = await loadNextDollarView(supabase, user.id, ladder).catch(() => null)

  return {
    nextDollar,
    totalValueUsd: Math.round(totalValueUsd),
    todayChangeUsd: Math.round(todayChangeUsd * 100) / 100,
    sinceStartChangeUsd: Math.round(sinceStartChangeUsd * 100) / 100,
    valueSeries,
    goal,
    goalCount: goals.length,
    weekItems,
    decisions,
    yearRange,
    tradingHalted,
  }
}
