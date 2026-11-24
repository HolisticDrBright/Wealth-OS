/**
 * Mobile Simple-mode data builders (Phases M2–M4) — client-agnostic: every
 * function takes a Supabase client already scoped to the user (the bearer
 * client from lib/supabase/bearer.ts, running under RLS) plus the userId.
 *
 * All values derive from the same tables and pure helpers the web uses
 * (goal-projection, weekly-summary, explore cap, transaction costs) — the
 * phone never reimplements sizing, risk, or kill-switch logic.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchSpxMonthlyReturns, fetchMonthlyReturns } from '@/lib/planning/market-returns'
import {
  medianOf, projectGoalMonths, addMonths, goalStatusOf,
  badYearSetbackMonths, type GoalStatus, type YearRangeUsd,
} from '@/lib/planning/goal-projection'
import { generateWeeklySummary, exitPhrase, isCostReason, isTier1Reason } from '@/lib/simple/weekly-summary'
import { getExploreUsage, type ExploreUsage } from '@/lib/explore/cap'
import { loadLadder } from '@/lib/allocation/ladder-data'
import { ladderSetupAmount, type Ladder } from '@/lib/allocation/ladder'
import { planLadderSetup, setupNeeded, coreDrift } from '@/lib/allocation/core-plans'
import { tierMixForTotal, yearRangeForMix, badYearFraction } from '@/lib/allocation/bad-year'
import { strategyRowsOnly, sleeveOfKey, LADDER_KEYS_FILTER } from '@/lib/allocation/sleeves'
import { CORE_FUNDS } from '@/lib/config/product-defaults'
import { roundTripCostUsd } from '@/lib/costs/transaction-costs'
import { liveTradingEnabled } from '@/lib/broker-adapters/execution-guard'

// ─── Shared row loaders ──────────────────────────────────────────────────────

interface ClosedRow { symbol: string; strategy_key: string | null; exit_reason: string | null; realized_pnl_usd: number | null; closed_at: string | null; asset_class: string }
interface OpenRow { symbol: string; strategy_key: string | null; notional_usd: number | null; unrealized_pnl_usd: number | null; opened_at: string | null; asset_class: string }

/**
 * STRATEGY (Explore) positions only — Core / Safety fund rows are valued by
 * the ladder (loadLadder → ladderPnlUsd), so they're never counted twice.
 */
async function loadPositions(supabase: SupabaseClient, userId: string) {
  const [closedRes, openRes, assetsRes] = await Promise.all([
    supabase.from('paper_positions')
      .select('symbol, strategy_key, exit_reason, realized_pnl_usd, closed_at, asset_class')
      .eq('user_id', userId).eq('status', 'closed').order('closed_at', { ascending: true }),
    supabase.from('paper_positions')
      .select('symbol, strategy_key, notional_usd, unrealized_pnl_usd, opened_at, asset_class')
      .eq('user_id', userId).eq('status', 'open'),
    supabase.from('assets').select('current_value').eq('user_id', userId),
  ])
  return {
    closed: strategyRowsOnly((closedRes.data ?? []) as ClosedRow[]),
    open: strategyRowsOnly((openRes.data ?? []) as OpenRow[]),
    baseAssetsUsd: ((assetsRes.data ?? []) as Array<{ current_value: number | null }>)
      .reduce((s, r) => s + (r.current_value ?? 0), 0),
  }
}

async function isHalted(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase.from('system_flags').select('user_id, enabled').eq('key', 'trading_halted')
  return ((data ?? []) as Array<{ user_id: string | null; enabled: boolean }>)
    .some(f => f.enabled && (f.user_id === null || f.user_id === userId))
}

interface GoalRow {
  id: string; name: string; target_amount_usd: number | string
  target_date: string | null; monthly_contribution_usd: number | string | null
}

async function loadGoals(supabase: SupabaseClient, userId: string): Promise<GoalRow[]> {
  const { data } = await supabase
    .from('household_goals')
    .select('id, name, target_amount_usd, target_date, monthly_contribution_usd, status, households!inner(owner_user_id)')
    .eq('status', 'active')
    .eq('households.owner_user_id', userId)
    .order('target_date', { ascending: true, nullsFirst: false })
  return (data ?? []) as unknown as GoalRow[]
}

export interface MobileGoalView {
  id: string
  name: string
  targetAmountUsd: number
  targetDate: string | null
  monthlyContributionUsd: number
  savedUsd: number
  fraction: number
  status: GoalStatus
  expectedDate: string | null
  badYearSetbackMonths: number | null
}

/** badYearFrac: the bad-year loss as a share of money (≤ 0) for the actual tier mix. */
function buildGoalView(g: GoalRow, savedUsd: number, returns: number[], badYearFrac: number | null): MobileGoalView {
  const targetAmountUsd = Number(g.target_amount_usd)
  const monthlyContributionUsd = Number(g.monthly_contribution_usd ?? 0)
  const medianMonthly = medianOf(returns)
  let expectedDate: string | null = null
  let setback: number | null = null
  if (medianMonthly != null) {
    const months = projectGoalMonths({
      currentUsd: savedUsd, monthlyContributionUsd, targetUsd: targetAmountUsd, monthlyReturn: medianMonthly,
    })
    if (months != null) expectedDate = addMonths(new Date().toISOString(), months)
    if (badYearFrac != null) {
      setback = badYearSetbackMonths({
        currentUsd: savedUsd, monthlyContributionUsd, targetUsd: targetAmountUsd,
        monthlyReturn: medianMonthly, badYearUsd: badYearFrac * savedUsd,
      })
    }
  }
  return {
    id: g.id, name: g.name, targetAmountUsd, targetDate: g.target_date, monthlyContributionUsd,
    savedUsd: Math.round(savedUsd),
    fraction: targetAmountUsd > 0 ? Math.min(1, savedUsd / targetAmountUsd) : 0,
    status: goalStatusOf(expectedDate, g.target_date),
    expectedDate,
    badYearSetbackMonths: setback,
  }
}

// ─── Home ────────────────────────────────────────────────────────────────────

export interface MobileHome {
  practiceMode: boolean
  tradingHalted: boolean
  totalValueUsd: number
  todayChangeUsd: number
  sinceStartChangeUsd: number
  valueSeries: Array<{ date: string; valueUsd: number }>
  goal: MobileGoalView | null
  goalCount: number
  /** Ladder decisions come first: Explore is $0 until Tier 1 Safety is funded. */
  decision: { kind: 'ladder_expenses' | 'ladder_setup' | 'core_rebalance' | 'rebalance'; title: string; subtitle: string; count: number } | null
  weekItems: string[]
}

export async function buildMobileHome(supabase: SupabaseClient, userId: string): Promise<MobileHome> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const todayUtc = new Date().toISOString().slice(0, 10)

  const [{ closed, open, baseAssetsUsd }, halted, goals, returns, bondReturns, blocksRes, suggestionsRes, ladder] = await Promise.all([
    loadPositions(supabase, userId),
    isHalted(supabase, userId),
    loadGoals(supabase, userId),
    fetchSpxMonthlyReturns(),
    fetchMonthlyReturns(CORE_FUNDS.bonds),
    supabase.from('audit_logs')
      .select('metadata').eq('user_id', userId).eq('decision', 'block').gte('decided_at', weekAgo),
    supabase.from('rebalance_suggestions')
      .select('id, action, asset_class, suggested_notional').eq('user_id', userId).eq('status', 'pending'),
    loadLadder(supabase, userId).catch(() => null),
  ])
  const depositsUsd = ladder?.depositsUsd ?? 0
  const ladderPnlUsd = ladder?.ladderPnlUsd ?? 0

  // Value series: base assets + cumulative realized P&L by close day.
  const byDay = new Map<string, number>()
  let totalRealized = 0
  let todayChangeUsd = 0
  for (const r of closed) {
    if (!r.closed_at) continue
    const day = r.closed_at.slice(0, 10)
    const pnl = r.realized_pnl_usd ?? 0
    byDay.set(day, (byDay.get(day) ?? 0) + pnl)
    totalRealized += pnl
    if (day === todayUtc) todayChangeUsd += pnl
  }
  let cum = 0
  const valueSeries = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, pnl]) => {
    cum += pnl
    return { date, valueUsd: Math.round(baseAssetsUsd + depositsUsd + cum) }
  })
  const totalUnrealized = open.reduce((s, r) => s + (r.unrealized_pnl_usd ?? 0), 0)
  // Strategy P&L + the Core / Safety funds' P&L; deposits add value, not gains.
  const sinceStartChangeUsd = totalRealized + totalUnrealized + ladderPnlUsd
  const totalValueUsd = baseAssetsUsd + depositsUsd + sinceStartChangeUsd

  const badFrac = ladder ? badYearFraction(tierMixForTotal(ladder, Math.max(0, totalValueUsd)), returns, bondReturns) : null
  const goal = goals.length ? buildGoalView(goals[0], Math.max(0, totalValueUsd), returns, badFrac) : null

  const openedThisWeek = open.filter(r => (r.opened_at ?? '') >= weekAgo)
  const closedThisWeek = closed.filter(r => (r.closed_at ?? '') >= weekAgo)
  const weekItems = generateWeeklySummary({
    closes: closedThisWeek.map(r => ({ symbol: r.symbol, exitReason: r.exit_reason, pnlUsd: r.realized_pnl_usd ?? 0 })),
    opens: openedThisWeek.map(r => ({ symbol: r.symbol })),
    blocked: ((blocksRes.data ?? []) as Array<{ metadata: Record<string, unknown> | null }>)
      .map(r => ({ reason: (r.metadata?.reason as string | undefined) ?? null })),
    halted,
  })

  const suggestions = (suggestionsRes.data ?? []) as Array<{ id: string }>
  let decision: MobileHome['decision'] = null
  if (ladder?.tier1.status === 'needs_expenses') {
    decision = {
      kind: 'ladder_expenses',
      title: 'Add your monthly expenses',
      subtitle: 'We size your safety cushion from them. Explore stays at $0 until it is full.',
      count: 1,
    }
  } else if (ladder && setupNeeded(ladder)) {
    const plan = planLadderSetup(ladder)
    const setupUsd = plan.reduce((sum, t) => sum + t.usd, 0)
    decision = {
      kind: 'ladder_setup',
      title: ladder.tier1.funded ? 'Invest your core' : 'Set up your safety cushion',
      subtitle: ladder.tier1.funded
        ? `Put $${Math.round(setupUsd).toLocaleString('en-US')} of practice money into your long-term funds. Takes one tap.`
        : `Move $${Math.round(ladderSetupAmount(ladder)).toLocaleString('en-US')} of practice money into cash first. Takes one tap.`,
      count: 1,
    }
  } else if (ladder && coreDrift(ladder).needsRebalance) {
    decision = {
      kind: 'core_rebalance',
      title: 'Rebalance your core funds',
      subtitle: 'Your stock/bond mix has drifted from your plan. Takes one tap.',
      count: 1,
    }
  } else if (suggestions.length > 0) {
    decision = {
      kind: 'rebalance',
      title: 'Rebalance your accounts',
      subtitle: 'Your recorded mix has drifted from your plan. Takes one tap.',
      count: suggestions.length,
    }
  }

  return {
    practiceMode: !liveTradingEnabled(),
    tradingHalted: halted,
    totalValueUsd: Math.round(totalValueUsd),
    todayChangeUsd: Math.round(todayChangeUsd * 100) / 100,
    sinceStartChangeUsd: Math.round(sinceStartChangeUsd * 100) / 100,
    valueSeries,
    goal,
    goalCount: goals.length,
    decision,
    weekItems,
  }
}

// ─── Goal detail ─────────────────────────────────────────────────────────────

export interface MobileGoalDetail {
  goals: MobileGoalView[]
  yearRange: YearRangeUsd | null
  split: { coreUsd: number; exploreUsd: number }
  exploreUsage: ExploreUsage
  /** The three-tier ladder (Safety / Core / Explore). */
  ladder: Ladder
  /** Dollars the "Set up your ladder" decision would place (0 = nothing waiting). */
  ladderSetupUsd: number
  /** True when Core has drifted past CORE_DRIFT_THRESHOLD and awaits approval. */
  coreRebalanceNeeded: boolean
}

export async function buildMobileGoal(supabase: SupabaseClient, userId: string): Promise<MobileGoalDetail> {
  const [{ closed, open, baseAssetsUsd }, goals, returns, bondReturns, usage, ladder] = await Promise.all([
    loadPositions(supabase, userId),
    loadGoals(supabase, userId),
    fetchSpxMonthlyReturns(),
    fetchMonthlyReturns(CORE_FUNDS.bonds),
    getExploreUsage(supabase, userId),
    loadLadder(supabase, userId),
  ])
  const totalRealized = closed.reduce((s, r) => s + (r.realized_pnl_usd ?? 0), 0)
  const totalUnrealized = open.reduce((s, r) => s + (r.unrealized_pnl_usd ?? 0), 0)
  const totalValueUsd = Math.max(0,
    baseAssetsUsd + ladder.depositsUsd + ladder.ladderPnlUsd + totalRealized + totalUnrealized)

  // Explore = everything strategies/copying hold right now; Core = the rest.
  const exploreUsd = usage.usedUsd
  const coreUsd = Math.max(0, totalValueUsd - exploreUsd)

  const mix = tierMixForTotal(ladder, totalValueUsd)
  const badFrac = badYearFraction(mix, returns, bondReturns)
  return {
    goals: goals.map(g => buildGoalView(g, totalValueUsd, returns, badFrac)),
    yearRange: yearRangeForMix(mix, returns, bondReturns),
    split: { coreUsd: Math.round(coreUsd), exploreUsd: Math.round(exploreUsd) },
    exploreUsage: usage,
    ladder,
    ladderSetupUsd: setupNeeded(ladder) ? planLadderSetup(ladder).reduce((sum, t) => sum + t.usd, 0) : 0,
    coreRebalanceNeeded: coreDrift(ladder).needsRebalance,
  }
}

// ─── Activity ────────────────────────────────────────────────────────────────

export interface MobileActivityItem {
  id: string
  /** 'Explore · Sold' style label parts. */
  sleeve: 'Safety' | 'Core' | 'Explore'
  type: string
  dateIso: string
  headline: string
  why: string
  kind: 'trade' | 'skipped'
}

function money(n: number): string {
  return `$${Math.round(Math.abs(n)).toLocaleString()}`
}

function plainBlockReason(reason: string | null): string {
  if (!reason) return "it didn't pass your safety rules."
  if (isTier1Reason(reason)) return "your safety cushion isn't full yet — Explore stays at $0 until it is."
  const r = reason.toLowerCase()
  if (isCostReason(reason)) return 'after fees and price movement, it was expected to earn less than it cost.'
  if (r.includes('explore_cap')) return 'it would have pushed Explore past the limit you set.'
  if (r.includes('kill_switch') || r.includes('halted')) return 'trading was paused at the time.'
  return "it didn't pass your safety rules."
}

export async function buildMobileActivity(
  supabase: SupabaseClient,
  userId: string,
  sinceDays = 28
): Promise<MobileActivityItem[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString()
  const [closesRes, opensRes, blocksRes] = await Promise.all([
    supabase.from('paper_positions')
      .select('id, symbol, strategy_key, exit_reason, realized_pnl_usd, closed_at')
      .eq('user_id', userId).eq('status', 'closed').gte('closed_at', since)
      .order('closed_at', { ascending: false }).limit(60),
    supabase.from('paper_positions')
      .select('id, symbol, opened_at, strategy_key, metadata')
      .eq('user_id', userId).gte('opened_at', since)
      .order('opened_at', { ascending: false }).limit(60),
    supabase.from('audit_logs')
      .select('id, symbol, strategy_key, metadata, decided_at')
      .eq('user_id', userId).eq('decision', 'block').gte('decided_at', since)
      .order('decided_at', { ascending: false }).limit(60),
  ])

  const items: MobileActivityItem[] = []

  for (const r of (closesRes.data ?? []) as Array<{ id: string; symbol: string; strategy_key: string | null; exit_reason: string | null; realized_pnl_usd: number | null; closed_at: string | null }>) {
    if (!r.closed_at) continue
    const pnl = r.realized_pnl_usd ?? 0
    const fund = sleeveOfKey(r.strategy_key)
    if (fund !== 'explore') {
      items.push({
        id: `close-${r.id}`,
        sleeve: fund === 'core' ? 'Core' : 'Safety',
        type: 'Sold',
        dateIso: r.closed_at,
        headline: `Sold some ${r.symbol} (${money(pnl)} ${pnl >= 0 ? 'gain' : 'loss'})`,
        why: 'Why: you approved a rebalance to bring your core funds back to your plan.',
        kind: 'trade',
      })
      continue
    }
    items.push({
      id: `close-${r.id}`,
      sleeve: 'Explore',
      type: 'Sold',
      dateIso: r.closed_at,
      headline: `Sold ${r.symbol} for a ${money(pnl)} ${pnl >= 0 ? 'gain' : 'loss'}`,
      why: `Why: ${exitPhrase(r.exit_reason)}. Small planned exits keep one position from hurting the whole account.`,
      kind: 'trade',
    })
  }

  for (const r of (opensRes.data ?? []) as Array<{ id: string; symbol: string; opened_at: string | null; strategy_key: string | null; metadata: Record<string, unknown> | null }>) {
    if (!r.opened_at) continue
    const fund = sleeveOfKey(r.strategy_key)
    // A partial fund sale is stored as a split-off lot; it's not a new buy.
    if (fund !== 'explore' && r.metadata?.split_from) continue
    if (fund !== 'explore') {
      items.push({
        id: `open-${r.id}`,
        sleeve: fund === 'core' ? 'Core' : 'Safety',
        type: 'Bought',
        dateIso: r.opened_at,
        headline: `Bought ${r.symbol} for your ${fund === 'core' ? 'long-term core' : 'safety cushion'}`,
        why: fund === 'core'
          ? 'Why: you approved putting long-term money into broad, low-cost funds.'
          : 'Why: you approved filling your safety cushion with a cash-like fund first.',
        kind: 'trade',
      })
      continue
    }
    items.push({
      id: `open-${r.id}`,
      sleeve: 'Explore',
      type: 'Bought',
      dateIso: r.opened_at,
      headline: `Opened a practice position in ${r.symbol}`,
      why: 'Why: one of your enabled playbooks found a setup; the position was sized within your limits with a loss limit attached.',
      kind: 'trade',
    })
  }

  for (const r of (blocksRes.data ?? []) as Array<{ id: string; symbol: string | null; strategy_key: string | null; metadata: Record<string, unknown> | null; decided_at: string | null }>) {
    if (!r.decided_at) continue
    const reason = (r.metadata?.reason as string | undefined) ?? null
    const isCore = r.strategy_key === 'rebalance'
    items.push({
      id: `block-${r.id}`,
      sleeve: isCore ? 'Core' : 'Explore',
      type: 'Skipped',
      dateIso: r.decided_at,
      headline: r.symbol && r.symbol !== 'ALL' ? `Passed on a ${r.symbol} trade idea` : 'Passed on a trade idea',
      why: `Why: ${plainBlockReason(reason)}`,
      kind: 'skipped',
    })
  }

  items.sort((a, b) => b.dateIso.localeCompare(a.dateIso))
  return items
}

// ─── Pause impact ────────────────────────────────────────────────────────────

/** What a pause would sell: Explore (strategy) positions only — never Core or Safety. */
export interface MobilePauseImpact {
  openPositions: number
  openNotionalUsd: number
  estimatedExitCostUsd: number
  pendingOrders: number
  tradingHalted: boolean
}

export async function buildPauseImpact(supabase: SupabaseClient, userId: string): Promise<MobilePauseImpact> {
  const [openRes, intentsRes, halted] = await Promise.all([
    supabase.from('paper_positions')
      .select('asset_class, notional_usd').not('strategy_key', 'in', LADDER_KEYS_FILTER)
      .eq('user_id', userId).eq('status', 'open'),
    supabase.from('order_intents')
      .select('id').eq('user_id', userId).in('status', ['pending', 'submitted', 'partially_filled']),
    isHalted(supabase, userId),
  ])
  const open = (openRes.data ?? []) as Array<{ asset_class: string; notional_usd: number | null }>
  const openNotionalUsd = open.reduce((s, r) => s + (r.notional_usd ?? 0), 0)
  const estimatedExitCostUsd = open.reduce(
    (s, r) => s + roundTripCostUsd(r.notional_usd ?? 0, r.asset_class) / 2, 0)
  return {
    openPositions: open.length,
    openNotionalUsd: Math.round(openNotionalUsd),
    estimatedExitCostUsd: Math.round(estimatedExitCostUsd * 100) / 100,
    pendingOrders: (intentsRes.data ?? []).length,
    tradingHalted: halted,
  }
}
