/**
 * Roadmap #3 — Explore must beat Core.
 *  - each closed strategy trade, after costs, vs the same dollars in Core over
 *    the same days (Core costs nothing extra), per strategy and in total,
 *  - the shrink rule: only after a meaningful stretch, only when Explore
 *    trails, never below the floor, never larger, snooze respected,
 *  - approval recorded BEFORE the limit changes; nothing is sold,
 *  - wiring on web (Explore page, Command Center, readiness) and phone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  coreReturnBetween, exploreVsCore, shrinkVerdict, shrinkSummary, type DailySeries, type ExploreTrade,
} from '@/lib/explore/vs-core'
import { roundTripCostBps } from '@/lib/costs/transaction-costs'
import {
  EXPLORE_REVIEW_LOOKBACK_DAYS, EXPLORE_REVIEW_MIN_DAYS, EXPLORE_REVIEW_MIN_TRADES,
  EXPLORE_SHRINK_FACTOR, EXPLORE_MIN_CAP_FRACTION, EXPLORE_SHRINK_SNOOZE_DAYS,
} from '@/lib/config/product-defaults'

const read = (p: string) => readFileSync(join(process.cwd(), ...p.split('/')), 'utf8')
const NOW = new Date('2026-11-24T00:00:00Z')

/** Daily series from start, growing `daily` per day. */
function series(start: string, days: number, daily: number, startPrice = 100) {
  const out: Array<{ date: string; close: number }> = []
  let p = startPrice
  for (let i = 0; i < days; i++) {
    out.push({ date: new Date(new Date(start).getTime() + i * 86_400_000).toISOString().slice(0, 10), close: p })
    p *= 1 + daily
  }
  return out
}
const SERIES: DailySeries = {
  VTI: series('2025-10-01', 430, 0.0004),
  VXUS: series('2025-10-01', 430, 0.0002),
  BND: series('2025-10-01', 430, 0.0001),
}
const WEIGHTS = [{ symbol: 'VTI', weight: 0.42 }, { symbol: 'VXUS', weight: 0.18 }, { symbol: 'BND', weight: 0.4 }]

const trade = (over: Partial<ExploreTrade> = {}): ExploreTrade => ({
  strategy_key: 'quant_momentum', asset_class: 'stocks', notional_usd: 1_000, realized_pnl_usd: 10,
  opened_at: '2026-03-02T15:00:00Z', closed_at: '2026-03-12T15:00:00Z', ...over,
})

describe('constants (product defaults)', () => {
  it('have the documented defaults', () => {
    expect(EXPLORE_REVIEW_LOOKBACK_DAYS).toBe(365)
    expect(EXPLORE_REVIEW_MIN_DAYS).toBe(180)
    expect(EXPLORE_REVIEW_MIN_TRADES).toBe(30)
    expect(EXPLORE_SHRINK_FACTOR).toBe(0.5)
    expect(EXPLORE_MIN_CAP_FRACTION).toBe(0.02)
    expect(EXPLORE_SHRINK_SNOOZE_DAYS).toBe(30)
  })
})

describe('Core return over a trade’s own days', () => {
  it('is the weighted return of each fund close-to-close', () => {
    const r = coreReturnBetween(SERIES, WEIGHTS, '2026-03-02', '2026-03-12')!
    const exp = 0.42 * (1.0004 ** 10 - 1) + 0.18 * (1.0002 ** 10 - 1) + 0.4 * (1.0001 ** 10 - 1)
    expect(r).toBeCloseTo(exp, 9)
  })
  it('same-day trades earn Core nothing; weekends use the last close', () => {
    expect(coreReturnBetween(SERIES, WEIGHTS, '2026-03-02T10:00:00Z', '2026-03-02T15:00:00Z')).toBe(0)
    const gappy: DailySeries = { VTI: [{ date: '2026-03-06', close: 100 }, { date: '2026-03-09', close: 110 }] }
    expect(coreReturnBetween(gappy, [{ symbol: 'VTI', weight: 1 }], '2026-03-07', '2026-03-09')).toBeCloseTo(0.1, 9)
  })
  it('no price history that far back → null (never a guess)', () => {
    expect(coreReturnBetween(SERIES, WEIGHTS, '2024-01-01', '2024-02-01')).toBeNull()
    expect(coreReturnBetween({ VTI: SERIES.VTI }, WEIGHTS, '2026-03-02', '2026-03-12')).toBeNull()
  })
})

describe('exploreVsCore — after costs, per strategy and in total', () => {
  it('subtracts the round-trip cost from the strategy, not from Core', () => {
    const c = exploreVsCore([trade()], SERIES, WEIGHTS, NOW)
    const cost = 1_000 * roundTripCostBps('stocks') / 10_000
    const core = 1_000 * coreReturnBetween(SERIES, WEIGHTS, '2026-03-02', '2026-03-12')!
    expect(c.total.netUsd).toBeCloseTo(10 - cost, 9)
    expect(c.total.coreUsd).toBeCloseTo(core, 9)
    expect(c.total.excessUsd).toBeCloseTo(10 - cost - core, 9)
    expect(c.total.excessPct).toBeCloseTo((10 - cost - core) / 1_000, 9)
  })
  it('groups per strategy (worst first) and counts unpriced trades', () => {
    const c = exploreVsCore([
      trade({ strategy_key: 'a', realized_pnl_usd: 50 }),
      trade({ strategy_key: 'b', realized_pnl_usd: -40 }),
      trade({ strategy_key: 'b', realized_pnl_usd: -10 }),
      trade({ strategy_key: 'c', opened_at: '2023-01-01T00:00:00Z', closed_at: '2023-01-05T00:00:00Z' }),
    ], SERIES, WEIGHTS, NOW)
    expect(c.perStrategy.map(s => s.strategyKey)).toEqual(['b', 'a', 'c'])
    expect(c.perStrategy.find(s => s.strategyKey === 'b')!.trades).toBe(2)
    expect(c.total.trades).toBe(3)
    expect(c.total.unpriced).toBe(1)
    expect(c.total.excessUsd).toBeCloseTo(c.perStrategy.reduce((s, l) => s + l.excessUsd, 0), 9)
  })
  it('measures the stretch from the oldest compared trade', () => {
    const c = exploreVsCore([trade({ opened_at: '2026-01-01T00:00:00Z', closed_at: '2026-01-05T00:00:00Z' })], SERIES, WEIGHTS, NOW)
    expect(c.daysCovered).toBe(327)
  })
})

describe('the shrink rule', () => {
  const losing = (n: number, opened = '2026-01-05T15:00:00Z') => exploreVsCore(
    Array.from({ length: n }, () => trade({ realized_pnl_usd: -5, opened_at: opened, closed_at: '2026-01-20T15:00:00Z' })),
    SERIES, WEIGHTS, NOW)
  const winning = exploreVsCore(
    Array.from({ length: 40 }, () => trade({ realized_pnl_usd: 80, opened_at: '2026-01-05T15:00:00Z', closed_at: '2026-01-20T15:00:00Z' })),
    SERIES, WEIGHTS, NOW)

  it(`waits for ${EXPLORE_REVIEW_MIN_TRADES} trades`, () => {
    const v = shrinkVerdict(losing(EXPLORE_REVIEW_MIN_TRADES - 1), { currentCapFraction: 0.1, snoozedUntil: null, now: NOW })
    expect(v.propose).toBe(false)
    expect(v.reason).toMatch(/Not enough history/)
  })
  it(`waits for ${EXPLORE_REVIEW_MIN_DAYS} days`, () => {
    const v = shrinkVerdict(losing(40, '2026-10-01T15:00:00Z'), { currentCapFraction: 0.1, snoozedUntil: null, now: NOW })
    expect(v.propose).toBe(false)
    expect(v.reason).toMatch(/Not enough time/)
  })
  it('keeps Explore when it beats Core', () => {
    expect(shrinkVerdict(winning, { currentCapFraction: 0.1, snoozedUntil: null, now: NOW }).propose).toBe(false)
  })
  it('proposes halving the limit when Explore trails Core over the stretch', () => {
    const v = shrinkVerdict(losing(40), { currentCapFraction: 0.1, snoozedUntil: null, now: NOW })
    expect(v).toMatchObject({ propose: true, currentCapFraction: 0.1, newCapFraction: 0.05 })
    expect(shrinkSummary(v)).toBe('Shrink my Explore limit from 10% to 5% because it trailed my Core funds. Nothing is sold; new strategy trades wait until Explore fits the smaller limit.')
  })
  it('never below the floor, and nothing at the floor', () => {
    expect(shrinkVerdict(losing(40), { currentCapFraction: 0.03, snoozedUntil: null, now: NOW }).newCapFraction).toBe(EXPLORE_MIN_CAP_FRACTION)
    expect(shrinkVerdict(losing(40), { currentCapFraction: EXPLORE_MIN_CAP_FRACTION, snoozedUntil: null, now: NOW }).propose).toBe(false)
  })
  it('respects "Not now"', () => {
    const v = shrinkVerdict(losing(40), { currentCapFraction: 0.1, snoozedUntil: '2026-12-01T00:00:00Z', now: NOW })
    expect(v.propose).toBe(false)
  })
  it('only ever proposes a SMALLER limit (property)', () => {
    for (let i = 0; i < 300; i++) {
      const cap = Math.random() * 0.25
      const v = shrinkVerdict(losing(30 + (i % 20)), { currentCapFraction: cap, snoozedUntil: null, now: NOW })
      if (v.propose) {
        expect(v.newCapFraction!).toBeLessThan(cap)
        expect(v.newCapFraction!).toBeGreaterThanOrEqual(EXPLORE_MIN_CAP_FRACTION)
      }
    }
  })
})

// ─── Approve / snooze against a recording fake ───────────────────────────────

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  writes: [] as Array<{ table: string; op: string; row: Record<string, unknown> }>,
}))

vi.mock('@/lib/allocation/ladder-data', () => ({
  loadLadder: async () => ({
    explore: { capFraction: 0.1 },
    core: { funds: [{ symbol: 'VTI', weight: 0.42 }, { symbol: 'VXUS', weight: 0.18 }, { symbol: 'BND', weight: 0.4 }] },
  }),
}))
vi.mock('@/lib/explore/cap', () => ({
  ensureCoreExploreSleeves: async () => ({ coreId: 'core-sleeve', exploreId: 'explore-sleeve' }),
}))

function client() {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'not', 'gte', 'limit']) c[m] = () => c
      c.maybeSingle = async () => ({ data: (db.tables[table] ?? [])[0] ?? null, error: null })
      c.insert = async (row: Record<string, unknown>) => { db.writes.push({ table, op: 'insert', row }); return { error: null } }
      c.upsert = async (row: Record<string, unknown>) => { db.writes.push({ table, op: 'upsert', row }); return { error: null } }
      c.update = (row: Record<string, unknown>) => {
        const u: Record<string, unknown> = {}
        const ids: unknown[] = []
        u.eq = (k: string, v: unknown) => {
          if (k === 'id') ids.push(v)
          if (k === 'user_id') { db.writes.push({ table, op: 'update', row: { ...row, id: ids[0] } }); return Promise.resolve({ error: null }) }
          return u
        }
        return u
      }
      c.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: db.tables[table] ?? [], error: null }).then(ok)
      return c
    },
  } as never
}

function stubYahoo() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const sym = decodeURIComponent(new URL(url).pathname.split('/').pop()!)
    const s = SERIES[sym] ?? []
    return new Response(JSON.stringify({ chart: { result: [{
      timestamp: s.map(p => Date.parse(p.date) / 1000 + 20 * 3600),
      indicators: { quote: [{ close: s.map(p => p.close) }] },
    }] } }))
  }))
}

beforeEach(() => {
  db.writes = []
  db.tables = {
    paper_positions: Array.from({ length: 40 }, () => trade({ realized_pnl_usd: -5, opened_at: '2026-01-05T15:00:00Z', closed_at: '2026-01-20T15:00:00Z' })) as never,
  }
  vi.unstubAllGlobals()
})

describe('approve and snooze', () => {
  it('records the approval FIRST, then lowers Explore and raises Core to match; never sells', async () => {
    stubYahoo()
    const { loadExploreVsCore, approveExploreShrink } = await import('@/lib/explore/vs-core-data')
    const view = await loadExploreVsCore(client(), 'u1', NOW)
    expect(view.available).toBe(true)
    expect(view.verdict.propose).toBe(true)
    const res = await approveExploreShrink(client(), 'u1', view.summary!)
    expect(res).toEqual({ ok: true, capFraction: 0.05 })
    const apprIdx = db.writes.findIndex(w => w.table === 'automation_approvals' && w.row.kind === 'explore_shrink')
    const sleeveIdx = db.writes.findIndex(w => w.table === 'portfolio_sleeves')
    expect(apprIdx).toBeGreaterThan(-1)
    expect(sleeveIdx).toBeGreaterThan(apprIdx)
    const sleeves = db.writes.filter(w => w.table === 'portfolio_sleeves').map(w => w.row)
    expect(sleeves).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'explore-sleeve', target_allocation_pct: 5 }),
      expect.objectContaining({ id: 'core-sleeve', target_allocation_pct: 95 }),
    ]))
    expect(db.writes.some(w => w.table === 'paper_positions')).toBe(false)
  })
  it('refuses without a summary, or when there is nothing to shrink', async () => {
    stubYahoo()
    const { approveExploreShrink } = await import('@/lib/explore/vs-core-data')
    expect((await approveExploreShrink(client(), 'u1', ' ')).ok).toBe(false)
    db.tables.paper_positions = []
    const r = await approveExploreShrink(client(), 'u1', 'Shrink my Explore limit')
    expect(r.ok).toBe(false)
    expect(db.writes).toEqual([])
  })
  it('no Core prices → no comparison, no proposal', async () => {
    vi.resetModules()   // drop the price cache filled by earlier tests
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const { loadExploreVsCore } = await import('@/lib/explore/vs-core-data')
    const v = await loadExploreVsCore(client(), 'u1', NOW)
    expect(v.available).toBe(false)
    expect(v.verdict.propose).toBe(false)
    expect(v.summary).toBeNull()
  })
  it('"Not now" snoozes for the configured days', async () => {
    const { snoozeExploreShrink } = await import('@/lib/explore/vs-core-data')
    await snoozeExploreShrink(client(), 'u1')
    const row = db.writes.find(w => w.table === 'explore_review_state')!.row
    const days = (Date.parse(String(row.snoozed_until)) - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(EXPLORE_SHRINK_SNOOZE_DAYS - 0.01)
    expect(days).toBeLessThan(EXPLORE_SHRINK_SNOOZE_DAYS + 0.01)
  })
})

describe('wiring', () => {
  it('web: Explore page card, Command Center decision, readiness column', () => {
    expect(read('app/(app)/traders/page.tsx')).toContain('<ExploreVsCoreCard')
    expect(read('lib/actions/command-center.ts')).toContain("kind: 'explore_shrink'")
    expect(read('app/(app)/strategies/readiness/page.tsx')).toContain('vs Core')
  })
  it('phone: Home decision and the shared approval core', () => {
    expect(read('lib/simple/mobile-data.ts')).toContain("kind: 'explore_shrink'")
    const route = read('app/api/mobile/approve/route.ts')
    const post = route.slice(route.indexOf('export async function POST'))
    expect(post).toContain('approveExploreShrink')
    expect(post.indexOf('approval_required')).toBeLessThan(post.indexOf('approveExploreShrink'))
  })
  it('migration 20260704q keeps every earlier approval kind and adds explore_shrink', () => {
    const sql = read('supabase/migrations/20260704q_explore_vs_core.sql')
    for (const k of ['enable_strategy', 'follow_trader', 'auto_copy', 'accept_rebalance', 'setup_ladder', 'core_rebalance', 'deposit', 'explore_shrink']) {
      expect(sql).toContain(`'${k}'`)
    }
    expect(sql).toContain('ALTER TABLE public.explore_review_state ENABLE ROW LEVEL SECURITY')
  })
})
