'use server'

/**
 * Web server actions for the "best next dollar" card (roadmap #1). Thin
 * wrappers over lib/advisory/next-dollar-data.ts with the cookie session.
 * Nothing here trades: answers are planning facts; accepting the raise prompt
 * changes a goal's monthly deposit.
 */

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  answerNextDollarFact, skipNextDollarFact, updateIncome, resolveRaisePrompt, parseFactAnswer,
  type WriteResult,
} from '@/lib/advisory/next-dollar-data'
import type { FactKey } from '@/lib/advisory/next-dollar-card'

async function withUser<T extends WriteResult>(fn: (s: Awaited<ReturnType<typeof createClient>>, uid: string) => Promise<T>): Promise<WriteResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not authenticated' }
  const res = await fn(supabase, user.id)
  if (res.ok) { revalidatePath('/dashboard'); revalidatePath('/advisor') }
  return { ok: res.ok, error: res.error }
}

export async function answerNextDollarAction(raw: Record<string, unknown>): Promise<WriteResult> {
  const answer = parseFactAnswer(raw)
  if (!answer) return { ok: false, error: 'That answer doesn’t look right — please check it.' }
  return withUser((s, uid) => answerNextDollarFact(s, uid, answer))
}

export async function skipNextDollarAction(fact: FactKey): Promise<WriteResult> {
  return withUser((s, uid) => skipNextDollarFact(s, uid, fact))
}

export async function updateIncomeAction(amountUsd: number): Promise<WriteResult> {
  return withUser((s, uid) => updateIncome(s, uid, amountUsd))
}

export async function resolveRaiseAction(accept: boolean): Promise<WriteResult> {
  return withUser((s, uid) => resolveRaisePrompt(s, uid, accept))
}
