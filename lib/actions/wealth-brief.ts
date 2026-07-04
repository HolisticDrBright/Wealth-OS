'use server'

/**
 * Daily/weekly wealth brief loader (upgrade item 10) — composes the checkup,
 * tax calendar, and paper-validation state into one short practical brief.
 * Rendering only; no notifications are sent.
 */

import { createClient } from '@/lib/supabase/server'
import { composeBrief, type WealthBrief } from '@/lib/advisory/brief'
import { getWealthCheckup } from '@/lib/actions/wealth-checkup'
import { getTaxCalendar } from '@/lib/actions/tax-calendar'
import { getPaperValidationData } from '@/lib/actions/paper-validation'

export async function getWealthBrief(): Promise<WealthBrief> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return composeBrief({
      checkupItems: [], bestNext: null, calendar: [], runbookBlockers: [],
      staleWarnings: [], killSwitchActive: false, deadWorkers: null,
      paper: { lastRunAt: null, reviewReady: 0, openPositions: 0, tracked: 0 },
    })
  }

  const [checkup, calendar, validation, killRes] = await Promise.all([
    getWealthCheckup(),
    getTaxCalendar(),
    getPaperValidationData(),
    supabase
      .from('system_flags')
      .select('user_id, enabled')
      .eq('key', 'trading_halted')
      .then(r => r.data ?? [], () => []),
  ])

  const killSwitchActive = (killRes as Array<{ user_id: string | null; enabled: boolean }>)
    .some(f => f.enabled && (f.user_id === null || f.user_id === user.id))

  const reviewReady = validation.scorecards.filter(s =>
    s.validationStatus === 'review_ready' || s.validationStatus === 'promotion_ready').length

  return composeBrief({
    checkupItems: checkup.items.map(i => ({ id: i.id, title: i.title, status: i.status, summary: i.summary })),
    bestNext: checkup.nextDollar.bestNext
      ? { title: checkup.nextDollar.bestNext.title, reason: checkup.nextDollar.bestNext.reason }
      : null,
    calendar: calendar.entries,
    runbookBlockers: validation.checklist.blockers,
    staleWarnings: [
      ...checkup.staleness.reasons,
      ...calendar.staleness.reasons,
    ],
    killSwitchActive,
    deadWorkers: validation.deadWorkers,
    paper: {
      lastRunAt: validation.lastRunAt,
      reviewReady,
      openPositions: validation.openPositions.length,
      tracked: validation.scorecards.length,
    },
  })
}
