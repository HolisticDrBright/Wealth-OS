/**
 * Typed client for the web app's /api/mobile/* endpoints (Phases M2–M4).
 *
 * Every call carries the user's Supabase JWT (apiFetch in lib/supabase.ts).
 * The server runs all queries as that user under RLS and owns every rule —
 * sizing, risk, kill switch, approvals. The phone only reads and asks.
 */

import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { apiFetch } from '@/lib/supabase'

// ─── Response shapes (mirror lib/simple/mobile-data.ts on the server) ────────

export type GoalStatus = 'on_track' | 'behind' | 'no_target_date' | 'unknown'

export interface GoalView {
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

export interface HomeData {
  practiceMode: boolean
  tradingHalted: boolean
  totalValueUsd: number
  todayChangeUsd: number
  sinceStartChangeUsd: number
  valueSeries: Array<{ date: string; valueUsd: number }>
  goal: GoalView | null
  goalCount: number
  decision: { kind: 'ladder_expenses' | 'ladder_setup' | 'core_rebalance' | 'rebalance'; title: string; subtitle: string; count: number } | null
  weekItems: string[]
  /** Set when scheduled strategy scans have stopped during market hours. */
  scanStale: { hoursSince: number | null } | null
  /** Where the next saved dollar should go (mirrors lib/advisory/next-dollar-data.ts). */
  nextDollar: NextDollarView | null
}

export type NextDollarFact =
  | 'monthly_expenses' | 'employer_match' | 'debts' | 'health_plan'
  | 'household_income' | 'filing_status' | 'ytd_ira' | 'ytd_401k'

export type NextDollarCard =
  | {
      kind: 'question'
      stepId: string
      fact: NextDollarFact
      why: string
      question: {
        prompt: string
        help: string | null
        input: 'number' | 'choice' | 'debt'
        choices?: Array<{ value: string; label: string }>
        skipLabel: string
      }
      progress: { answered: number; total: number }
    }
  | { kind: 'recommendation'; stepId: string; title: string; body: string; action: 'add_money' | 'none'; skippedChecks: string[] }

export interface RaisePrompt {
  incomeBeforeUsd: number
  incomeNowUsd: number
  raiseUsd: number
  goalId: string
  goalName: string
  currentMonthlyUsd: number
  increaseUsd: number
  suggestedMonthlyUsd: number
}

export interface NextDollarView {
  card: NextDollarCard
  raise: RaisePrompt | null
  disclaimer: string
}

export interface ExploreUsage {
  capFraction: number
  totalValueUsd: number
  /** Money the cap is measured against: investable minus Tier 1 Safety. */
  baseUsd: number
  capUsd: number
  usedUsd: number
  leftUsd: number
  /** Explore is $0 until Tier 1 Safety is fully funded. */
  tier1Funded: boolean
  closedReason: string | null
}

/** The three-tier ladder (mirrors lib/allocation/ladder.ts on the server). */
export interface CoreFund {
  slot: string
  symbol: string
  assetClass: 'stock' | 'bond' | 'cash'
  weight: number
  targetUsd: number
  heldUsd: number
}

export interface Ladder {
  investableUsd: number
  fundingUsd: number
  depositsUsd: number
  ladderPnlUsd: number
  unplacedUsd: number
  tier1: {
    status: 'funded' | 'short' | 'needs_expenses'
    funded: boolean
    targetUsd: number | null
    emergencyUsd: number | null
    shortGoalsUsd: number
    shortGoals: Array<{ name: string; targetAmountUsd: number; targetDate: string | null }>
    heldUsd: number
    inFundUsd: number
    amountUsd: number
    shortfallUsd: number
    reason: string | null
  }
  /** Core = real paper fund positions; heldUsd is what they're worth now. */
  core: { targetUsd: number; heldUsd: number; invested: boolean; stockShare: number; bondShare: number; funds: CoreFund[] }
  explore: { capFraction: number; baseUsd: number; capUsd: number; inUseUsd: number; leftUsd: number; open: boolean; reason: string | null }
}

export interface GoalData {
  goals: GoalView[]
  yearRange: { goodYearUsd: number; typicalYearUsd: number; badYearUsd: number } | null
  split: { coreUsd: number; exploreUsd: number }
  exploreUsage: ExploreUsage
  ladder: Ladder
  ladderSetupUsd: number
  coreRebalanceNeeded: boolean
}

export interface ActivityItem {
  id: string
  sleeve: 'Safety' | 'Core' | 'Explore'
  type: string
  dateIso: string
  headline: string
  why: string
  kind: 'trade' | 'skipped'
}

export interface ApproveDecision {
  kind: 'ladder_setup' | 'core_rebalance' | 'rebalance'
  title: string
  explanation: string
  /** Before/after bar, e.g. { label: 'cash', beforePct: 4, afterPct: 18 }. */
  change: { label: string; beforePct: number; afterPct: number } | null
  amountMovedUsd: number
  estimatedCostUsd: number
  estimatedTaxUsd: number
  taxNote: string | null
  badYearBeforeUsd: number | null
  badYearAfterUsd: number | null
  doNothing: string
  /** The exact text the user approves (recorded server-side). */
  summary: string
}

export interface ExploreTrader {
  id: string
  name: string
  handle: string
  assetClass: string
  bio: string | null
  verified: boolean
  following: boolean
  autoCopyEnabled: boolean
  copier: { headlinePct: number; copierPct: number; isEstimate: boolean; explanation: string }
  swing: 'lower' | 'bigger'
  practiceRun: { dayN: number; totalDays: number; complete: boolean } | null
  autoCopyUnlocked: boolean
}

export interface ExploreData {
  usage: ExploreUsage
  traders: ExploreTrader[]
}

export interface PauseImpact {
  openPositions: number
  openNotionalUsd: number
  estimatedExitCostUsd: number
  pendingOrders: number
  tradingHalted: boolean
}

// ─── Calls ───────────────────────────────────────────────────────────────────

export class ApiError extends Error {}

async function getJson<T>(path: string): Promise<T> {
  const res = await apiFetch(path)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `Request failed (${res.status})`)
  return body as T
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(payload) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `Request failed (${res.status})`)
  return body as T
}

export const api = {
  home: () => getJson<HomeData>('/api/mobile/home'),
  goal: () => getJson<GoalData>('/api/mobile/goal'),
  setMonthlyDeposit: (goalId: string, amount: number) =>
    postJson<{ ok: boolean }>('/api/mobile/goal', { goal_id: goalId, monthly_contribution_usd: amount }),
  activity: () => getJson<{ items: ActivityItem[] }>('/api/mobile/activity'),
  approval: () => getJson<{ decision: ApproveDecision | null }>('/api/mobile/approve'),
  approve: (kind: ApproveDecision['kind'], summary: string) =>
    postJson<{ ok: boolean; kind: string; executed: number; skippedOrders: string[]; errors: string[]; safetyUsd?: number; coreUsd?: number }>(
      '/api/mobile/approve', { kind, approved_summary: summary }),
  /** Add practice money: fills Safety first, then Core. */
  deposit: (amount: number) =>
    postJson<{ ok: boolean; safetyUsd: number; coreUsd: number; executed: number; errors: string[] }>(
      '/api/mobile/deposit', { amount_usd: amount }),
  setMonthlyExpenses: (amount: number) =>
    postJson<{ ok: boolean }>('/api/mobile/goal', { monthly_expenses_usd: amount }),
  /** Best-next-dollar card actions. */
  nextDollarAnswer: (answer: Record<string, unknown>) =>
    postJson<{ ok: boolean }>('/api/mobile/next-dollar', { action: 'answer', ...answer }),
  nextDollarSkip: (fact: NextDollarFact) =>
    postJson<{ ok: boolean }>('/api/mobile/next-dollar', { action: 'skip', fact }),
  updateIncome: (amount: number) =>
    postJson<{ ok: boolean }>('/api/mobile/next-dollar', { action: 'income', amount_usd: amount }),
  resolveRaise: (accept: boolean) =>
    postJson<{ ok: boolean }>('/api/mobile/next-dollar', { action: 'raise', accept }),
  explore: () => getJson<ExploreData>('/api/mobile/explore'),
  follow: (traderId: string, summary: string) =>
    postJson<{ ok: boolean }>('/api/mobile/follow', { trader_id: traderId, approved_summary: summary }),
  unfollow: (traderId: string) =>
    postJson<{ ok: boolean }>('/api/mobile/follow', { trader_id: traderId, unfollow: true }),
  pauseImpact: () => getJson<PauseImpact>('/api/mobile/pause'),
  pause: (sellExplore: boolean) =>
    postJson<{ ok: boolean; closed: number; cancelledOrders: number; failures: string[] }>(
      '/api/mobile/pause', { sell_explore: sellExplore }),
  resume: () => postJson<{ ok: boolean }>('/api/mobile/resume', { confirm: true }),
}

// ─── Hook: load on focus, with loading / error / refresh ─────────────────────

export function useApi<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    setError(null)
    try {
      setData(await loader())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
    // loader identity is stable per screen (module-level api fns)
  }, [])

  useEffect(() => { void load() }, [load])
  // Reload when the screen regains focus (e.g. after closing Approve/Pause).
  useFocusEffect(useCallback(() => { void load(true) }, [load]))

  return { data, error, loading, refreshing, reload: () => load(true) }
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

export function monthYear(iso: string | null): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
