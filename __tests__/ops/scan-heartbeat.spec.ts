/**
 * Phase 6 — protect the track record.
 *  - market clock (US equities, DST-aware),
 *  - stale = market hours AND no successful scheduled scan in SCAN_STALE_HOURS,
 *  - gaps = past stretches where the stale banner would have shown,
 *  - every scan run is recorded (start + finish), alerts are deduplicated,
 *  - the readiness page lists every strategy and is read-only,
 *  - migration contract.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isMarketHours, overlapsMarketHours, scanStaleness, findScanGaps, gapsSince,
  recordScan, alertIfScanStale, getScanHealth, SCAN_STALE_ALERT_TITLE, type ScanHealth,
} from '@/lib/ops/scan-heartbeat'
import { summarizeTrackRecord, computeDrawdown } from '@/lib/strategies/track-record'
import { MIN_CLOSED_TRADES } from '@/lib/strategies/promotion-gates'
import {
  SCAN_STALE_HOURS, MARKET_TIMEZONE, MARKET_OPEN_MINUTES, MARKET_CLOSE_MINUTES, SCAN_GAP_LOOKBACK_DAYS,
} from '@/lib/config/product-defaults'
import { roundTripCostBps } from '@/lib/costs/transaction-costs'

const read = (p: string) => readFileSync(join(process.cwd(), ...p.split('/')), 'utf8')
const H = 3_600_000
const at = (iso: string) => new Date(iso)

describe('constants (product defaults)', () => {
  it('have the documented defaults', () => {
    expect(SCAN_STALE_HOURS).toBe(6)
    expect(MARKET_TIMEZONE).toBe('America/New_York')
    expect(MARKET_OPEN_MINUTES).toBe(570)
    expect(MARKET_CLOSE_MINUTES).toBe(960)
    expect(SCAN_GAP_LOOKBACK_DAYS).toBe(90)
    expect(MIN_CLOSED_TRADES).toBe(30)
  })
})

describe('market clock', () => {
  it('winter (EST, UTC−5)', () => {
    expect(isMarketHours(at('2026-11-24T14:29:00Z'))).toBe(false)   // 9:29
    expect(isMarketHours(at('2026-11-24T14:30:00Z'))).toBe(true)    // 9:30
    expect(isMarketHours(at('2026-11-24T20:59:00Z'))).toBe(true)    // 15:59
    expect(isMarketHours(at('2026-11-24T21:00:00Z'))).toBe(false)   // 16:00
  })
  it('summer (EDT, UTC−4)', () => {
    expect(isMarketHours(at('2026-07-07T13:29:00Z'))).toBe(false)
    expect(isMarketHours(at('2026-07-07T13:30:00Z'))).toBe(true)
    expect(isMarketHours(at('2026-07-07T20:00:00Z'))).toBe(false)
  })
  it('weekends are closed', () => {
    expect(isMarketHours(at('2026-11-28T16:00:00Z'))).toBe(false)   // Saturday
    expect(isMarketHours(at('2026-11-29T16:00:00Z'))).toBe(false)   // Sunday
  })
  it('overlap across a DST switch day stays exact', () => {
    // 2026-03-09 (Mon, first EDT weekday): open 13:30Z.
    expect(overlapsMarketHours(at('2026-03-09T13:00:00Z').getTime(), at('2026-03-09T13:31:00Z').getTime())).toBe(true)
    expect(overlapsMarketHours(at('2026-03-09T13:00:00Z').getTime(), at('2026-03-09T13:30:00Z').getTime())).toBe(false)
  })
})

describe('staleness — market hours only', () => {
  const tueMidday = at('2026-11-24T17:00:00Z')   // 12:00 ET
  it(`stale after more than ${SCAN_STALE_HOURS}h without a successful scheduled scan`, () => {
    expect(scanStaleness(new Date(tueMidday.getTime() - 7 * H).toISOString(), tueMidday).stale).toBe(true)
    expect(scanStaleness(new Date(tueMidday.getTime() - 5 * H).toISOString(), tueMidday).stale).toBe(false)
  })
  it('never stale outside market hours, however old the last run', () => {
    expect(scanStaleness('2026-11-20T00:00:00Z', at('2026-11-28T17:00:00Z')).stale).toBe(false)   // Saturday
    expect(scanStaleness('2026-11-20T00:00:00Z', at('2026-11-25T03:00:00Z')).stale).toBe(false)   // 22:00 ET
  })
  it('a scheduler that never ran is stale during market hours', () => {
    expect(scanStaleness(null, tueMidday)).toMatchObject({ stale: true, hoursSince: null })
  })
})

/** Successful runs every `stepMin` minutes over [fromIso, toIso), minus `skip` ranges. */
function runs(fromIso: string, toIso: string, stepMin: number, skip: Array<[string, string]> = []): string[] {
  const out: string[] = []
  for (let t = at(fromIso).getTime(); t < at(toIso).getTime(); t += stepMin * 60_000) {
    if (skip.some(([a, b]) => t >= at(a).getTime() && t < at(b).getTime())) continue
    out.push(new Date(t).toISOString())
  }
  return out
}

describe('gap detection', () => {
  const now = at('2026-11-27T22:00:00Z')    // Friday evening
  const from = at('2026-11-23T00:00:00Z')   // Monday
  it('steady scans → no gaps', () => {
    expect(findScanGaps(runs('2026-11-23T00:00:00Z', '2026-11-27T22:00:00Z', 15), from, now)).toEqual([])
  })
  it('a missing market day is flagged', () => {
    const r = runs('2026-11-23T00:00:00Z', '2026-11-27T22:00:00Z', 15, [['2026-11-25T08:00:00Z', '2026-11-26T02:00:00Z']])
    const gaps = findScanGaps(r, from, now)
    expect(gaps).toHaveLength(1)
    expect(gaps[0].hours).toBeGreaterThan(SCAN_STALE_HOURS)
    expect(gaps[0].from.startsWith('2026-11-25T07:45')).toBe(true)
  })
  it('a long outage outside market hours is NOT a gap', () => {
    // Fri 22:00Z → Mon 13:00Z (before the open) — no market time missed.
    const r = [...runs('2026-11-23T00:00:00Z', '2026-11-27T22:00:00Z', 15), ...runs('2026-11-30T13:00:00Z', '2026-11-30T16:00:00Z', 15)]
    expect(findScanGaps(r, from, at('2026-11-30T16:00:00Z'))).toEqual([])
  })
  it('a gap still running now is open', () => {
    const r = runs('2026-11-23T00:00:00Z', '2026-11-24T08:00:00Z', 15)
    const gaps = findScanGaps(r, from, at('2026-11-24T17:00:00Z'))
    expect(gaps).toHaveLength(1)
    expect(gaps[0].open).toBe(true)
  })
  it('gapsSince keeps only gaps after a strategy’s first trade', () => {
    const gaps = [
      { from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z', hours: 24, open: false },
      { from: '2026-11-10T00:00:00Z', to: '2026-11-11T00:00:00Z', hours: 24, open: false },
    ]
    expect(gapsSince(gaps, '2026-11-01T00:00:00Z')).toHaveLength(1)
    expect(gapsSince(gaps, null)).toEqual([])
  })
})

// ─── Writers / readers with a recording fake ─────────────────────────────────

function fake(opts: { failInsert?: boolean; tables?: Record<string, Array<Record<string, unknown>>>; readError?: boolean } = {}) {
  const writes: Array<{ table: string; op: string; row: Record<string, unknown> }> = []
  const tables = opts.tables ?? {}
  const client = {
    from: (table: string) => {
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'gte', 'order', 'limit']) c[m] = () => c
      c.insert = (row: Record<string, unknown>) => {
        writes.push({ table, op: 'insert', row })
        const res = opts.failInsert ? { data: null, error: { message: 'no table' } } : { data: { id: 'hb1' }, error: null }
        return { select: () => ({ single: async () => res }), then: (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok) }
      }
      c.update = (row: Record<string, unknown>) => ({ eq: async () => { writes.push({ table, op: 'update', row }); return { error: null } } })
      c.then = (ok: (v: unknown) => unknown) => Promise.resolve(opts.readError
        ? { data: null, error: { message: 'relation does not exist' } }
        : { data: tables[table] ?? [], error: null }).then(ok)
      return c
    },
  }
  return { client: client as never, writes }
}

describe('recordScan — every run recorded, never changes the scan', () => {
  it('start row (running) then finish ok with counts', async () => {
    const { client, writes } = fake()
    const r = await recordScan(client, { source: 'scan-all', scheduled: true }, async () => 42, () => ({ strategiesRun: 7 }))
    expect(r).toBe(42)
    expect(writes[0]).toMatchObject({ op: 'insert', row: { source: 'scan-all', scheduled: true, status: 'running', user_id: null } })
    expect(writes[1]).toMatchObject({ op: 'update', row: { status: 'ok', strategies_run: 7 } })
  })
  it('a failing scan is recorded as failed and the error still surfaces', async () => {
    const { client, writes } = fake()
    await expect(recordScan(client, { source: 'cron:daily', scheduled: true }, async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(writes[1]).toMatchObject({ op: 'update', row: { status: 'failed', error: 'boom' } })
  })
  it('a heartbeat that cannot be written does not stop the scan', async () => {
    const { client } = fake({ failInsert: true })
    expect(await recordScan(client, { source: 'manual', scheduled: false, userId: 'u1' }, async () => 'ran')).toBe('ran')
  })
})

describe('alerts and health', () => {
  const stale: ScanHealth = { stale: true, inMarketHours: true, lastOkAt: '2026-11-24T08:00:00Z', hoursSince: 9.2, available: true, gaps: [], windowStart: '' }
  it('raises one alert per stale episode, in the alerts table’s base shape', async () => {
    const { client, writes } = fake()
    expect(await alertIfScanStale(client, 'u1', stale)).toBe(true)
    expect(writes[0]).toMatchObject({ table: 'alerts', row: { user_id: 'u1', type: 'system', severity: 'warning', title: SCAN_STALE_ALERT_TITLE } })
    expect(String(writes[0].row.body)).toContain('9 hours')
    const again = fake({ tables: { alerts: [{ id: 'a1' }] } })
    expect(await alertIfScanStale(again.client, 'u1', stale)).toBe(false)
    expect(again.writes).toEqual([])
  })
  it('nothing raised when healthy', async () => {
    const { client, writes } = fake()
    expect(await alertIfScanStale(client, 'u1', { ...stale, stale: false })).toBe(false)
    expect(writes).toEqual([])
  })
  it('an unreadable heartbeat table is "unavailable", never a false alarm', async () => {
    const { client } = fake({ readError: true })
    const h = await getScanHealth(client, at('2026-11-24T17:00:00Z'))
    expect(h).toMatchObject({ available: false, stale: false })
  })
})

describe('track-record math', () => {
  it('net after costs = realized P&L − round-trip cost on each notional', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      strategy_key: 'pead', realized_pnl_pct: i % 2 ? 0.02 : -0.01, realized_pnl_usd: i % 2 ? 20 : -10,
      notional_usd: 1_000, opened_at: `2026-11-0${i + 1}T14:00:00Z`, closed_at: `2026-11-0${i + 1}T18:00:00Z`,
    }))
    const s = summarizeTrackRecord(rows, 'stocks')
    expect(s.closedTrades).toBe(6)
    expect(s.grossPnlUsd).toBe(30)
    expect(s.costsUsd).toBeCloseTo(6 * 1_000 * roundTripCostBps('stocks') / 10_000, 9)
    expect(s.netAfterCostsUsd).toBeCloseTo(s.grossPnlUsd - s.costsUsd, 9)
    expect(s.firstTradeAt).toBe('2026-11-01T14:00:00Z')
    expect(s.maxDrawdownPct).toBe(computeDrawdown(rows))
  })
})

describe('wiring', () => {
  it('scheduled scan-all and the daily cron pass are recorded as scheduled scans', () => {
    const scan = read('app/api/internal/scan-all/route.ts')
    expect(scan).toContain("recordScan(")
    expect(scan).toContain("source: 'scan-all', scheduled: true")
    expect(read('lib/cron/tasks.ts')).toContain("source: 'cron:daily', scheduled: true")
  })
  it('manual runs are recorded but never count as the scheduler', () => {
    expect(read('app/api/paper-trading/run/route.ts')).toContain("source: 'manual', scheduled: false")
  })
  it('the banner is on every authenticated page and on the phone home', () => {
    expect(read('app/(app)/layout.tsx')).toContain('<ScanHealthBanner')
    expect(read('lib/simple/mobile-data.ts')).toContain('scanStale')
    expect(read('apps/mobile/app/(tabs)/index.tsx')).toContain('data.scanStale')
  })
  it('the readiness page lists EVERY strategy and is read-only (no promote control)', () => {
    const action = read('lib/actions/track-record.ts')
    expect(action).toContain('Object.keys(STRATEGY_REGISTRY_CONFIG)')
    expect(action).not.toMatch(/\.(insert|update|upsert|delete)\(/)
    const page = read('app/(app)/strategies/readiness/page.tsx')
    expect(page).not.toMatch(/<button|<form|onClick|action=/)
    expect(page).not.toMatch(/>\s*Promote/i)
    expect(page).toContain("uiMode !== 'pro'")
    for (const col of ['Maturity', 'Closed trades', 'Net after costs', 'Max drawdown', 'Gates passed', 'Scan gaps']) {
      expect(page).toContain(col)
    }
  })
})

describe('migration 20260704n_scan_heartbeats.sql', () => {
  const sql = read('supabase/migrations/20260704n_scan_heartbeats.sql')
  it('scan_heartbeats with RLS; users can only write their own unscheduled runs', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.scan_heartbeats')
    expect(sql).toContain('ALTER TABLE public.scan_heartbeats ENABLE ROW LEVEL SECURITY')
    expect(sql).toMatch(/FOR INSERT\s+WITH CHECK \(user_id = auth\.uid\(\) AND scheduled = false\)/)
    expect(sql).toMatch(/status IN \('running','ok','failed'\)/)
  })
  it('creates the missing worker_heartbeats table the dead-man switch reads', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.worker_heartbeats')
    expect(sql).toContain('ALTER TABLE public.worker_heartbeats ENABLE ROW LEVEL SECURITY')
  })
})
