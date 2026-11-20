'use server'

/**
 * Web server actions for the three-tier ladder (Phase 2). Thin wrappers over
 * lib/allocation/ladder-data.ts using the cookie session (RLS as the user).
 */

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  loadLadder, saveMonthlyExpenses, approveLadderSetup, ladderSetupSummary,
} from '@/lib/allocation/ladder-data'
import { ladderSetupAmount, type Ladder } from '@/lib/allocation/ladder'

export interface LadderView {
  ladder: Ladder
  /** Present when a "Set up your ladder" decision is waiting. */
  setup: { amountUsd: number; summary: string } | null
}

export async function getLadderView(): Promise<LadderView | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  try {
    const ladder = await loadLadder(supabase, user.id)
    const amount = ladderSetupAmount(ladder)
    return {
      ladder,
      setup: amount > 0 && ladder.tier1.targetUsd != null
        ? { amountUsd: amount, summary: ladderSetupSummary(amount, ladder.tier1.targetUsd) }
        : null,
    }
  } catch {
    return null
  }
}

export async function setMonthlyExpensesAction(amountUsd: number): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not authenticated' }
  const res = await saveMonthlyExpenses(supabase, user.id, amountUsd)
  if (res.ok) { revalidatePath('/advisor'); revalidatePath('/dashboard') }
  return res
}

export async function approveLadderSetupAction(approvedSummary: string): Promise<{ ok: boolean; designatedUsd: number; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, designatedUsd: 0, error: 'not authenticated' }
  const res = await approveLadderSetup(supabase, user.id, approvedSummary)
  if (res.ok) { revalidatePath('/advisor'); revalidatePath('/dashboard'); revalidatePath('/traders') }
  return { ok: res.ok, designatedUsd: res.designatedUsd, error: res.error }
}
