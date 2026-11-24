'use server'

/**
 * AI committee cost-and-value (roadmap #7) — web server actions, cookie
 * session (RLS as the user). Pro mode only.
 */

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getUiMode } from '@/lib/actions/ui-prefs'
import { loadCommitteeReport, setCommitteeAgentEnabled } from '@/lib/agents/committee-data'

export async function getCommitteeReport() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return loadCommitteeReport(supabase, user.id).catch(() => null)
}

export async function setCommitteeAgentAction(agent: string, enabled: boolean, approvedSummary?: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not authenticated' }
  if ((await getUiMode()) !== 'pro') return { ok: false, error: 'the AI committee can only be changed in pro mode' }
  const res = await setCommitteeAgentEnabled(supabase, user.id, agent, enabled, approvedSummary)
  if (res.ok) revalidatePath('/strategies/committee')
  return res
}
