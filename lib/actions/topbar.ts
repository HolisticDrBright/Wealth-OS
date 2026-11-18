'use server'

/**
 * Topbar identity + unread alerts (Phase 7.3). Replaces the hardcoded "W"
 * avatar and the always-on bell dot with real data.
 */

import { createClient } from '@/lib/supabase/server'
import { getUnreadAlertCount } from '@/lib/actions/alerts'
import { initialsOf } from '@/lib/ui/initials'

export interface TopbarInfo {
  initials: string
  displayName: string
  unreadAlerts: number
}

export async function getTopbarInfo(): Promise<TopbarInfo | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const fullName = (user.user_metadata?.full_name as string | undefined)?.trim()
  const displayName = fullName || user.email || 'Your account'
  const unreadAlerts = await getUnreadAlertCount().catch(() => 0)

  return { initials: initialsOf(displayName), displayName, unreadAlerts }
}
