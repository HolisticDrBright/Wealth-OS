/**
 * Scan heartbeat (Phase 6) — protect the track record.
 *
 * Every scan run writes a scan_heartbeats row at START ('running') and
 * updates it at the END ('ok' / 'failed'). From those rows:
 *
 *   stale  — it is US market hours and no SCHEDULED scan has finished OK in
 *            the last SCAN_STALE_HOURS. Raises an alert and a banner on every
 *            page. (Outside market hours nothing is stale.)
 *   gap    — a past stretch between two successful scheduled scans during
 *            which the stale banner WOULD have been up. Gaps are flagged on
 *            the promotion-readiness page: a paper track record with holes
 *            is not the same evidence as a continuous one.
 *
 * Market hours: Mon–Fri, MARKET_OPEN_MINUTES–MARKET_CLOSE_MINUTES in
 * MARKET_TIMEZONE. Exchange holidays are not modeled (a holiday with no scans
 * would be flagged — the strict side).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  SCAN_STALE_HOURS, MARKET_TIMEZONE, MARKET_OPEN_MINUTES, MARKET_CLOSE_MINUTES, SCAN_GAP_LOOKBACK_DAYS,
} from '@/lib/config/product-defaults'

const HOUR = 3_600_000
const DAY = 86_400_000

// ─── Market clock (pure) ─────────────────────────────────────────────────────

const _fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: MARKET_TIMEZONE, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
})

interface LocalParts { y: number; m: number; d: number; hh: number; mm: number; weekday: number }
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function localParts(ms: number): LocalParts {
  const p = Object.fromEntries(_fmt.formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, weekday: WEEKDAY[p.weekday] ?? 0 }
}

/** UTC offset of the market timezone at `ms`, in ms (local = utc + offset). */
function offsetAt(ms: number): number {
  const p = localParts(ms)
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) - Math.floor(ms / 60_000) * 60_000
}

export function isMarketHours(at: Date | number): boolean {
  const ms = typeof at === 'number' ? at : at.getTime()
  const p = localParts(ms)
  if (p.weekday === 0 || p.weekday === 6) return false
  const minutes = p.hh * 60 + p.mm
  return minutes >= MARKET_OPEN_MINUTES && minutes < MARKET_CLOSE_MINUTES
}

/** The market sessions (open/close instants, UTC ms) on local days touching [startMs, endMs]. */
export function marketSessions(startMs: number, endMs: number): Array<{ open: number; close: number }> {
  const out: Array<{ open: number; close: number }> = []
  // 12-hour steps so a DST shift can never skip a local day (duplicates are dropped).
  for (let t = startMs - DAY; t <= endMs + DAY; t += DAY / 2) {
    const p = localParts(t)
    if (p.weekday === 0 || p.weekday === 6) continue
    const midnightLocalAsUtc = Date.UTC(p.y, p.m - 1, p.d)
    // Offset taken mid-morning that day (after any 2 a.m. DST switch).
    const off = offsetAt(midnightLocalAsUtc + 12 * HOUR)
    const open = midnightLocalAsUtc + MARKET_OPEN_MINUTES * 60_000 - off
    const close = midnightLocalAsUtc + MARKET_CLOSE_MINUTES * 60_000 - off
    if (!out.some(s => s.open === open)) out.push({ open, close })
  }
  return out.sort((a, b) => a.open - b.open)
}

/** True when any instant in [startMs, endMs) falls inside market hours. */
export function overlapsMarketHours(startMs: number, endMs: number): boolean {
  if (!(endMs > startMs)) return false
  return marketSessions(startMs, endMs).some(s => s.open < endMs && s.close > startMs)
}

// ─── Staleness and gaps (pure) ───────────────────────────────────────────────

export interface ScanStaleness {
  stale: boolean
  inMarketHours: boolean
  lastOkAt: string | null
  /** Hours since the last successful scheduled scan (null = never). */
  hoursSince: number | null
}

export function scanStaleness(lastOkAt: string | null, now: Date = new Date()): ScanStaleness {
  const inMarketHours = isMarketHours(now)
  const hoursSince = lastOkAt ? (now.getTime() - new Date(lastOkAt).getTime()) / HOUR : null
  const stale = inMarketHours && (hoursSince == null || hoursSince > SCAN_STALE_HOURS)
  return { stale, inMarketHours, lastOkAt, hoursSince }
}

export interface ScanGap {
  /** Last successful scheduled scan before the gap (null = before the window). */
  from: string
  /** First successful scheduled scan after the gap (or "now" when still open). */
  to: string
  hours: number
  open: boolean
}

/**
 * Stretches between successful scheduled scans during which the stale banner
 * would have shown: longer than SCAN_STALE_HOURS and touching market hours
 * after the threshold passed. `okRuns` = finished_at of successful runs.
 */
export function findScanGaps(okRuns: string[], windowStart: Date, now: Date = new Date()): ScanGap[] {
  const times = okRuns.map(t => new Date(t).getTime()).filter(Number.isFinite).sort((a, b) => a - b)
  const points = [windowStart.getTime(), ...times.filter(t => t > windowStart.getTime() && t <= now.getTime())]
  const gaps: ScanGap[] = []
  const threshold = SCAN_STALE_HOURS * HOUR
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = i + 1 < points.length ? points[i + 1] : now.getTime()
    if (b - a > threshold && overlapsMarketHours(a + threshold, b)) {
      gaps.push({ from: new Date(a).toISOString(), to: new Date(b).toISOString(), hours: Math.round((b - a) / HOUR * 10) / 10, open: i + 1 >= points.length })
    }
  }
  return gaps
}

/** Gaps that overlap [fromIso, now] — e.g. since a strategy's first trade. */
export function gapsSince(gaps: ScanGap[], fromIso: string | null): ScanGap[] {
  if (!fromIso) return []
  const from = new Date(fromIso).getTime()
  return gaps.filter(g => new Date(g.to).getTime() > from)
}

// ─── Writers ─────────────────────────────────────────────────────────────────

export interface ScanCounts {
  usersScanned?: number
  strategiesRun?: number
  opportunitiesFound?: number
  positionsOpened?: number
}

/** Start a heartbeat row. Never throws; null when it couldn't be written. */
export async function startScanHeartbeat(
  supabase: SupabaseClient,
  args: { source: string; scheduled: boolean; userId?: string | null },
): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('scan_heartbeats').insert({
      source: args.source, scheduled: args.scheduled, user_id: args.userId ?? null,
      status: 'running', started_at: new Date().toISOString(),
    }).select('id').single()
    if (error || !data) {
      console.warn('[scan-heartbeat] start failed:', error?.message)
      return null
    }
    return (data as { id: string }).id
  } catch (err) {
    console.warn('[scan-heartbeat] start failed:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function finishScanHeartbeat(
  supabase: SupabaseClient,
  id: string | null,
  result: { status: 'ok' | 'failed'; counts?: ScanCounts; error?: string | null },
): Promise<void> {
  if (!id) return
  try {
    const c = result.counts ?? {}
    await supabase.from('scan_heartbeats').update({
      status: result.status, finished_at: new Date().toISOString(),
      users_scanned: c.usersScanned ?? null, strategies_run: c.strategiesRun ?? null,
      opportunities_found: c.opportunitiesFound ?? null, positions_opened: c.positionsOpened ?? null,
      error: result.error ? String(result.error).slice(0, 2000) : null,
    }).eq('id', id)
  } catch (err) {
    console.warn('[scan-heartbeat] finish failed:', err instanceof Error ? err.message : err)
  }
}

/**
 * Run `fn` as a recorded scan: heartbeat first, then 'ok' with counts or
 * 'failed' with the error (which is re-thrown). Heartbeat failures never
 * change the scan's own behavior.
 */
export async function recordScan<T>(
  supabase: SupabaseClient,
  args: { source: string; scheduled: boolean; userId?: string | null },
  fn: () => Promise<T>,
  countsOf: (r: T) => ScanCounts = () => ({}),
): Promise<T> {
  const id = await startScanHeartbeat(supabase, args)
  try {
    const result = await fn()
    await finishScanHeartbeat(supabase, id, { status: 'ok', counts: countsOf(result) })
    return result
  } catch (err) {
    await finishScanHeartbeat(supabase, id, { status: 'failed', error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

// ─── Readers + alert ─────────────────────────────────────────────────────────

export interface ScanHealth extends ScanStaleness {
  /** False when the heartbeat table can't be read (e.g. migration not applied). */
  available: boolean
  gaps: ScanGap[]
  windowStart: string
}

export async function getScanHealth(supabase: SupabaseClient, now: Date = new Date()): Promise<ScanHealth> {
  const windowStart = new Date(now.getTime() - SCAN_GAP_LOOKBACK_DAYS * DAY)
  const { data, error } = await supabase
    .from('scan_heartbeats')
    .select('finished_at')
    .eq('scheduled', true)
    .eq('status', 'ok')
    .gte('finished_at', windowStart.toISOString())
    .order('finished_at', { ascending: false })
    .limit(20_000)
  if (error) {
    return { ...scanStaleness(null, now), stale: false, available: false, gaps: [], windowStart: windowStart.toISOString() }
  }
  const okRuns = ((data ?? []) as Array<{ finished_at: string | null }>).map(r => r.finished_at).filter((t): t is string => !!t)
  // The newest finish might be older than the window — look it up separately.
  let lastOkAt: string | null = okRuns.length ? okRuns[0] : null
  if (!lastOkAt) {
    const { data: last } = await supabase.from('scan_heartbeats').select('finished_at')
      .eq('scheduled', true).eq('status', 'ok').order('finished_at', { ascending: false }).limit(1)
    lastOkAt = ((last ?? []) as Array<{ finished_at: string | null }>)[0]?.finished_at ?? null
  }
  // Gaps start from the earliest scan in the window (not the window edge) so a
  // brand-new install isn't flagged for the months before it existed.
  const earliest = okRuns.length ? okRuns[okRuns.length - 1] : null
  const gapStart = earliest ? new Date(earliest) : windowStart
  return {
    ...scanStaleness(lastOkAt, now),
    available: true,
    gaps: earliest ? findScanGaps(okRuns, gapStart, now) : [],
    windowStart: windowStart.toISOString(),
  }
}

/** Cheap check for every page: only the newest successful scheduled scan. */
export async function getScanStaleness(supabase: SupabaseClient, now: Date = new Date()): Promise<ScanHealth> {
  const windowStart = new Date(now.getTime() - SCAN_GAP_LOOKBACK_DAYS * DAY).toISOString()
  const { data, error } = await supabase.from('scan_heartbeats').select('finished_at')
    .eq('scheduled', true).eq('status', 'ok').order('finished_at', { ascending: false }).limit(1)
  if (error) return { ...scanStaleness(null, now), stale: false, available: false, gaps: [], windowStart }
  const lastOkAt = ((data ?? []) as Array<{ finished_at: string | null }>)[0]?.finished_at ?? null
  return { ...scanStaleness(lastOkAt, now), available: true, gaps: [], windowStart }
}

export const SCAN_STALE_ALERT_TITLE = 'Strategy scans have stopped'

/**
 * Raise the stale alert for a user — once per stale episode (no duplicate
 * since the last successful scan). Uses the alerts table's base shape.
 */
export async function alertIfScanStale(supabase: SupabaseClient, userId: string, health: ScanHealth): Promise<boolean> {
  if (!health.available || !health.stale) return false
  const since = health.lastOkAt ?? new Date(0).toISOString()
  const { data: existing } = await supabase.from('alerts').select('id')
    .eq('user_id', userId).eq('title', SCAN_STALE_ALERT_TITLE).gte('created_at', since).limit(1)
  if ((existing ?? []).length > 0) return false
  const hours = health.hoursSince == null ? null : Math.floor(health.hoursSince)
  const { error } = await supabase.from('alerts').insert({
    user_id: userId, type: 'system', severity: 'warning', title: SCAN_STALE_ALERT_TITLE,
    body: hours == null
      ? 'No scheduled strategy scan has ever finished. Paper results have no track record yet.'
      : `No scheduled strategy scan has finished in ${hours} hours during market hours. Nothing is being traded, and paper results will show a gap for this stretch.`,
    action_url: '/strategies/readiness',
    metadata: { kind: 'scan_stale', last_ok_at: health.lastOkAt },
  })
  if (error) console.warn('[scan-heartbeat] stale alert failed:', error.message)
  return !error
}
