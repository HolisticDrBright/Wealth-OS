/**
 * Ladder loader + write cores (Phases 2–3) — client-agnostic: callers pass a
 * Supabase client already scoped to the user (cookie session on the web,
 * bearer client on mobile, admin client in the paper runner).
 *
 * Every write that trades (setup, deposit, Core rebalance) records its
 * approval FIRST, then executes paper fund trades. Paper only.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { computeLadder, type Ladder, type LadderGoal } from '@/lib/allocation/ladder'
import { LADDER_KEYS_FILTER } from '@/lib/allocation/sleeves'
import {
  planLadderSetup, planDeposit, coreDrift, planCoreRebalance, type FundTrade,
} from '@/lib/allocation/core-plans'
import { loadLadderHoldings, executeFundTrades } from '@/lib/allocation/core-trading'
import { CORE_FUNDS } from '@/lib/config/product-defaults'

export async function loadLadder(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<Ladder> {
  const [assetsRes, profileRes, riskRes, goalsRes, sleevesRes, stateRes, paperRes, copiedRes, depositsRes, holdings] = await Promise.all([
    supabase.from('assets').select('category, current_value').eq('user_id', userId),
    supabase.from('financial_profile').select('monthly_essential_expenses_usd').eq('user_id', userId).maybeSingle(),
    supabase.from('user_risk_profile').select('profile_key').eq('user_id', userId).maybeSingle(),
    supabase.from('household_goals')
      .select('id, name, target_amount_usd, target_date, status, households!inner(owner_user_id)')
      .eq('status', 'active')
      .eq('households.owner_user_id', userId),
    supabase.from('portfolio_sleeves').select('target_allocation_pct, metadata').eq('user_id', userId),
    supabase.from('ladder_state').select('tier1_designated_usd').eq('user_id', userId).maybeSingle(),
    supabase.from('paper_positions').select('notional_usd').not('strategy_key', 'in', LADDER_KEYS_FILTER).eq('user_id', userId).eq('status', 'open'),
    supabase.from('user_copied_positions').select('notional_value').eq('user_id', userId).eq('status', 'open'),
    // Missing table (migration 20260704m not applied) → no deposits, not an error.
    supabase.from('paper_deposits').select('amount_usd').eq('user_id', userId),
    loadLadderHoldings(supabase, userId),
  ])

  const expensesRaw = (profileRes.data as { monthly_essential_expenses_usd?: number | string | null } | null)
    ?.monthly_essential_expenses_usd
  const monthlyExpensesUsd = expensesRaw == null ? null : Number(expensesRaw)

  const explore = ((sleevesRes.data ?? []) as Array<{ target_allocation_pct: number | null; metadata: Record<string, unknown> | null }>)
    .find(s => s.metadata?.kind === 'explore')

  const goals: LadderGoal[] = ((goalsRes.data ?? []) as Array<{
    id: string; name: string; target_amount_usd: number | string; target_date: string | null
  }>).map(g => ({
    id: g.id, name: g.name,
    targetAmountUsd: Number(g.target_amount_usd),
    targetDate: g.target_date,
  }))

  const exploreInUseUsd =
    ((paperRes.data ?? []) as Array<{ notional_usd: number | null }>).reduce((s, r) => s + (r.notional_usd ?? 0), 0) +
    ((copiedRes.data ?? []) as Array<{ notional_value: number | null }>).reduce((s, r) => s + (r.notional_value ?? 0), 0)

  return computeLadder({
    assets: (assetsRes.data ?? []) as Array<{ category: string; current_value: number | null }>,
    monthlyExpensesUsd: monthlyExpensesUsd != null && Number.isFinite(monthlyExpensesUsd) ? monthlyExpensesUsd : null,
    goals,
    profileKey: (riskRes.data?.profile_key as string | undefined) ?? null,
    exploreCapFraction: explore?.target_allocation_pct != null ? Number(explore.target_allocation_pct) / 100 : null,
    tier1DesignatedUsd: Number((stateRes.data as { tier1_designated_usd?: number | string } | null)?.tier1_designated_usd ?? 0),
    exploreInUseUsd,
    holdings,
    depositsUsd: ((depositsRes.data ?? []) as Array<{ amount_usd: number | string }>)
      .reduce((sum, d) => sum + Number(d.amount_usd), 0),
    now,
  })
}

/** Save essential monthly expenses (the existing financial_profile column). */
export async function saveMonthlyExpenses(
  supabase: SupabaseClient,
  userId: string,
  amountUsd: number,
): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isFinite(amountUsd) || amountUsd < 0) {
    return { ok: false, error: 'Monthly expenses must be zero or more' }
  }
  const { error } = await supabase
    .from('financial_profile')
    .upsert({ user_id: userId, monthly_essential_expenses_usd: amountUsd, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' })
  return error ? { ok: false, error: error.message } : { ok: true }
}

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

function describeTrades(trades: FundTrade[]): { safetyUsd: number; coreUsd: number; coreSymbols: string[] } {
  const safetyUsd = trades.filter(t => t.sleeve === 'safety' && t.side === 'buy').reduce((s, t) => s + t.usd, 0)
  const core = trades.filter(t => t.sleeve === 'core' && t.side === 'buy')
  return { safetyUsd, coreUsd: core.reduce((s, t) => s + t.usd, 0), coreSymbols: core.map(t => t.symbol) }
}

/** Plain-language text the user approves for the ladder setup. */
export function ladderSetupSummary(trades: FundTrade[]): string {
  const d = describeTrades(trades)
  const parts: string[] = []
  if (d.safetyUsd > 0) parts.push(`move ${usd(d.safetyUsd)} into a cash-like fund (${CORE_FUNDS.cashLike}) for safety`)
  if (d.coreUsd > 0) parts.push(`invest ${usd(d.coreUsd)} in my core funds (${d.coreSymbols.join(', ')})`)
  return `Set up my money ladder: ${parts.join(', then ')}. Practice money — nothing real is sold.`
}

export interface LadderTradeResult {
  ok: boolean
  safetyUsd: number
  coreUsd: number
  /** Paper fund trades that went through. */
  executed: number
  failures: string[]
  ladder?: Ladder
  error?: string
}

/**
 * Approve the one-tap "Set up your ladder" decision. Records the approval,
 * then (paper) buys the cash-like fund for the Tier 1 shortfall and each Core
 * fund up to target. Any Phase 2 designation is converted into real paper
 * cash-like holdings at the same time.
 */
export async function approveLadderSetup(
  supabase: SupabaseClient,
  userId: string,
  approvedSummary: string,
): Promise<LadderTradeResult> {
  const fail = (error: string): LadderTradeResult => ({ ok: false, safetyUsd: 0, coreUsd: 0, executed: 0, failures: [], error })
  if (!approvedSummary.trim()) return fail('approval_required: approved summary missing')
  const ladder = await loadLadder(supabase, userId)
  if (ladder.tier1.status === 'needs_expenses') return fail('Add your monthly expenses first')

  const { data: stateRow } = await supabase
    .from('ladder_state').select('tier1_designated_usd').eq('user_id', userId).maybeSingle()
  const designated = Number((stateRow as { tier1_designated_usd?: number | string } | null)?.tier1_designated_usd ?? 0)

  const trades = planLadderSetup(ladder)
  if (designated > 0) {
    trades.unshift({ sleeve: 'safety', symbol: CORE_FUNDS.cashLike, side: 'buy', usd: Math.round(designated * 100) / 100 })
  }
  if (!trades.length) return fail('Nothing to set up — your ladder is already in place')

  const { error: apprErr } = await supabase.from('automation_approvals').insert({
    user_id: userId, kind: 'setup_ladder', subject: 'ladder', summary: approvedSummary,
    metadata: { trades, tier1_target_usd: ladder.tier1.targetUsd },
  })
  if (apprErr) return fail(`could not record approval: ${apprErr.message}`)

  const { results, failures } = await executeFundTrades(supabase, userId, trades, 'setup')

  // The designation became real holdings only if its buy succeeded.
  if (designated > 0 && results[0]?.ok) {
    await supabase.from('ladder_state').upsert({
      user_id: userId, tier1_designated_usd: 0,
      setup_approved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
  } else {
    await supabase.from('ladder_state').upsert({
      user_id: userId, tier1_designated_usd: designated,
      setup_approved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
  }

  const okTrades = results.filter(r => r.ok).map(r => r.trade)
  const done = describeTrades(okTrades)
  return {
    ok: failures.length === 0, safetyUsd: done.safetyUsd, coreUsd: done.coreUsd,
    executed: okTrades.length, failures, ladder: await loadLadder(supabase, userId),
  }
}

/** Plain-language text for a deposit. */
export function depositSummary(amountUsd: number, trades: FundTrade[]): string {
  const d = describeTrades(trades)
  const parts: string[] = []
  if (d.safetyUsd > 0) parts.push(`${usd(d.safetyUsd)} to my safety cushion`)
  if (d.coreUsd > 0) parts.push(`${usd(d.coreUsd)} to my core funds (${d.coreSymbols.join(', ')})`)
  return `Add ${usd(amountUsd)} of practice money: ${parts.length ? parts.join(', ') : 'held as cash'}.`
}

/**
 * Add new practice money. It fills Tier 1 first, then Core — the fund furthest
 * below target first. Recorded as a deposit (never added to strategy equity).
 */
export async function depositFunds(
  supabase: SupabaseClient,
  userId: string,
  amountUsd: number,
): Promise<LadderTradeResult> {
  const fail = (error: string): LadderTradeResult => ({ ok: false, safetyUsd: 0, coreUsd: 0, executed: 0, failures: [], error })
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return fail('Deposit must be more than $0')
  const before = await loadLadder(supabase, userId)
  const plan = planDeposit(before, amountUsd)
  const summary = depositSummary(amountUsd, plan.trades)

  const { error: depErr } = await supabase.from('paper_deposits').insert({
    user_id: userId, amount_usd: amountUsd,
    allocation: { tier1_usd: plan.tier1Usd, core_usd: plan.coreUsd, trades: plan.trades },
  })
  if (depErr) return fail(`could not record deposit: ${depErr.message}`)
  await supabase.from('automation_approvals').insert({
    user_id: userId, kind: 'deposit', subject: 'deposit', summary, metadata: { amount_usd: amountUsd },
  }).then(() => {}, () => {})

  const { results, failures } = await executeFundTrades(supabase, userId, plan.trades, 'deposit')
  const okTrades = results.filter(r => r.ok).map(r => r.trade)
  const done = describeTrades(okTrades)
  return {
    ok: failures.length === 0, safetyUsd: done.safetyUsd, coreUsd: done.coreUsd,
    executed: okTrades.length, failures, ladder: await loadLadder(supabase, userId),
  }
}

/** Plain-language text for a Core rebalance. */
export function coreRebalanceSummary(trades: FundTrade[]): string {
  const sells = trades.filter(t => t.side === 'sell')
  const buys = trades.filter(t => t.side === 'buy')
  const list = (ts: FundTrade[]) => ts.map(t => `${usd(t.usd)} of ${t.symbol}`).join(' and ')
  return `Rebalance my core funds: sell ${list(sells) || 'nothing'}, buy ${list(buys) || 'nothing'}, ` +
    `back to my plan. Practice money — nothing real is sold.`
}

/**
 * Approve a Core rebalance (raised only when drift exceeds
 * CORE_DRIFT_THRESHOLD). Core is never traded without this approval.
 */
export async function approveCoreRebalance(
  supabase: SupabaseClient,
  userId: string,
  approvedSummary: string,
): Promise<LadderTradeResult> {
  const fail = (error: string): LadderTradeResult => ({ ok: false, safetyUsd: 0, coreUsd: 0, executed: 0, failures: [], error })
  if (!approvedSummary.trim()) return fail('approval_required: approved summary missing')
  const ladder = await loadLadder(supabase, userId)
  if (!coreDrift(ladder).needsRebalance) return fail('Your core funds are already within your plan')
  const trades = planCoreRebalance(ladder)

  const { error: apprErr } = await supabase.from('automation_approvals').insert({
    user_id: userId, kind: 'core_rebalance', subject: 'core', summary: approvedSummary, metadata: { trades },
  })
  if (apprErr) return fail(`could not record approval: ${apprErr.message}`)

  const { results, failures } = await executeFundTrades(supabase, userId, trades, 'rebalance')
  const okTrades = results.filter(r => r.ok).map(r => r.trade)
  const done = describeTrades(okTrades)
  return {
    ok: failures.length === 0, safetyUsd: done.safetyUsd, coreUsd: done.coreUsd,
    executed: okTrades.length, failures, ladder: await loadLadder(supabase, userId),
  }
}
