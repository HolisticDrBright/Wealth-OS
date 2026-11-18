'use server'

/**
 * Approval-before-automation (Phase 4.3). In simple mode, nothing new starts
 * trading automatically: these helpers record the user's explicit approval of
 * a plain-language summary, and the write paths require one.
 */

import { createClient } from '@/lib/supabase/server'
import { getUiMode } from '@/lib/actions/ui-prefs'

export type ApprovalKind = 'enable_strategy' | 'follow_trader' | 'auto_copy' | 'accept_rebalance'

export async function recordAutomationApproval(args: {
  kind: ApprovalKind
  subject: string
  summary: string
  metadata?: Record<string, unknown>
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not authenticated' }
  if (!args.summary.trim()) return { ok: false, error: 'summary required' }

  const { error } = await supabase.from('automation_approvals').insert({
    user_id: user.id,
    kind: args.kind,
    subject: args.subject,
    summary: args.summary,
    metadata: args.metadata ?? {},
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

/**
 * True when the current mode requires an explicit approval for automation
 * writes (simple mode). Pro mode keeps today's behavior.
 */
export async function approvalRequired(): Promise<boolean> {
  return (await getUiMode()) === 'simple'
}
