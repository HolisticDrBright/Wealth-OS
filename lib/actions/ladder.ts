'use server'

/**
 * Web server actions for the three-tier ladder (Phases 2–3). Thin wrappers
 * over lib/allocation/ladder-data.ts using the cookie session (RLS as the user).
 */

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  loadLadder, saveMonthlyExpenses, approveLadderSetup, ladderSetupSummary,
  depositFunds, approveCoreRebalance, coreRebalanceSummary, type LadderTradeResult,
} from '@/lib/allocation/ladder-data'
import { planLadderSetup, setupNeeded, coreDrift, planCoreRebalance, type CoreDrift } from '@/lib/allocation/core-plans'
import type { Ladder } from '@/lib/allocation/ladder'

export interface LadderView {
  ladder: Ladder
  /** Present when the "Set up your ladder" decision is waiting. */
  setup: { safetyUsd: number; coreUsd: number; summary: string } | null
  /** Present when Core has drifted past CORE_DRIFT_THRESHOLD. */
  rebalance: { drift: CoreDrift; summary: string } | null
}

export async function getLadderView(): Promise<LadderView | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  try {
    const ladder = await loadLadder(supabase, user.id)
    const trades = planLadderSetup(ladder)
    const drift = coreDrift(ladder)
    return {
      ladder,
      setup: setupNeeded(ladder)
        ? {
            safetyUsd: trades.filter(t => t.sleeve === 'safety').reduce((s, t) => s + t.usd, 0),
            coreUsd: trades.filter(t => t.sleeve === 'core').reduce((s, t) => s + t.usd, 0),
            summary: ladderSetupSummary(trades),
          }
        : null,
      rebalance: drift.needsRebalance
        ? { drift, summary: coreRebalanceSummary(planCoreRebalance(ladder)) }
        : null,
    }
  } catch {
    return null
  }
}

function revalidateLadder() {
  revalidatePath('/advisor'); revalidatePath('/dashboard'); revalidatePath('/traders')
}

async function withUser<T>(fn: (supabase: Awaited<ReturnType<typeof createClient>>, userId: string) => Promise<T>, unauth: T): Promise<T> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return unauth
  return fn(supabase, user.id)
}

const UNAUTH: LadderTradeResult = { ok: false, safetyUsd: 0, coreUsd: 0, executed: 0, failures: [], error: 'not authenticated' }
const plain = (r: LadderTradeResult): Omit<LadderTradeResult, 'ladder'> =>
  ({ ok: r.ok, safetyUsd: r.safetyUsd, coreUsd: r.coreUsd, executed: r.executed, failures: r.failures, error: r.error })

export async function setMonthlyExpensesAction(amountUsd: number): Promise<{ ok: boolean; error?: string }> {
  return withUser(async (supabase, userId) => {
    const res = await saveMonthlyExpenses(supabase, userId, amountUsd)
    if (res.ok) revalidateLadder()
    return res
  }, { ok: false, error: 'not authenticated' })
}

export async function approveLadderSetupAction(approvedSummary: string) {
  return withUser(async (supabase, userId) => {
    const res = await approveLadderSetup(supabase, userId, approvedSummary)
    revalidateLadder()
    return plain(res)
  }, plain(UNAUTH))
}

export async function depositAction(amountUsd: number) {
  return withUser(async (supabase, userId) => {
    const res = await depositFunds(supabase, userId, amountUsd)
    revalidateLadder()
    return plain(res)
  }, plain(UNAUTH))
}

export async function approveCoreRebalanceAction(approvedSummary: string) {
  return withUser(async (supabase, userId) => {
    const res = await approveCoreRebalance(supabase, userId, approvedSummary)
    revalidateLadder()
    return plain(res)
  }, plain(UNAUTH))
}
