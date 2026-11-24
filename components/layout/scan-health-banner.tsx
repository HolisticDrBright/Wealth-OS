/**
 * Stale-scan banner (Phase 6) — on every authenticated page. Shows only when
 * it is US market hours and no scheduled strategy scan has finished in
 * SCAN_STALE_HOURS; raises the user's alert once per stale episode.
 * Renders nothing when healthy, outside market hours, or if the heartbeat
 * table can't be read.
 */

import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getScanStaleness, alertIfScanStale } from '@/lib/ops/scan-heartbeat'
import { SCAN_STALE_HOURS } from '@/lib/config/product-defaults'

/** Hours since the last good scan when stale, undefined when not (or unknown). */
async function staleHours(): Promise<number | null | undefined> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return undefined
    const health = await getScanStaleness(supabase)
    if (!health.stale) return undefined
    await alertIfScanStale(supabase, user.id, health).catch(() => false)
    return health.hoursSince == null ? null : Math.floor(health.hoursSince)
  } catch {
    return undefined
  }
}

export async function ScanHealthBanner({ uiMode }: { uiMode: 'simple' | 'pro' }) {
  const hours = await staleHours()
  if (hours === undefined) return null
  return (
    <div role="alert" className="border-b border-orange-500/40 bg-orange-950/30 px-4 py-2 text-[13px] text-orange-100">
      <strong className="font-semibold">Strategy scans have stopped.</strong>{' '}
      {hours == null
        ? 'No scheduled scan has finished yet.'
        : `No scheduled scan has finished in ${hours} hours (limit ${SCAN_STALE_HOURS}) during market hours.`}{' '}
      {uiMode === 'pro'
        ? <>Nothing new is being traded, and paper results will show a gap for this stretch. <Link href="/strategies/readiness" className="underline">See the track record</Link>.</>
        : 'Nothing new is being bought or sold until they resume. Your money is not affected.'}
    </div>
  )
}
