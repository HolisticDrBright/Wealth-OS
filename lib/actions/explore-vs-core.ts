'use server'

/**
 * Web server actions for "Explore must beat Core" (roadmap #3). Thin wrappers
 * over lib/explore/vs-core-data.ts with the cookie session. The only write that
 * changes money rules is approving a SHRINK of the Explore limit.
 */

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  loadExploreVsCore, approveExploreShrink, snoozeExploreShrink, type ExploreVsCoreView, type ShrinkResult,
} from '@/lib/explore/vs-core-data'

export async function getExploreVsCore(): Promise<ExploreVsCoreView | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return loadExploreVsCore(supabase, user.id).catch(() => null)
}

function refresh() {
  revalidatePath('/traders'); revalidatePath('/dashboard'); revalidatePath('/strategies/readiness')
}

export async function approveExploreShrinkAction(approvedSummary: string): Promise<ShrinkResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not authenticated' }
  const res = await approveExploreShrink(supabase, user.id, approvedSummary)
  if (res.ok) refresh()
  return res
}

export async function snoozeExploreShrinkAction(): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not authenticated' }
  const res = await snoozeExploreShrink(supabase, user.id)
  if (res.ok) refresh()
  return res
}
