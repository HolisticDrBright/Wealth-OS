/**
 * Phase 2 — the three-tier ladder.
 *  - glide path (profile-anchored, tilt caps the upside, 25% of the long share
 *    at the 2-year mark) and the dollar-weighted multi-goal blend,
 *  - Tier 1 sizing, holdings-level funding, and the strict Explore gate,
 *  - the one-tap "Set up your ladder" write path (approval recorded first),
 *  - plain-English reasons, onboarding, migration, and "only reduce".
 */

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  glideFraction, glideCeiling, longHorizonStockShare, goalStockShare,
  coreStockShare, yearsUntil, isShortHorizon, clampExploreCapFraction,
} from '@/lib/allocation/policy'
import { computeLadder, ladderSetupAmount, type LadderInput } from '@/lib/allocation/ladder'
import { exploreCapVerdict, type ExploreUsage } from '@/lib/explore/cap'
import { generateWeeklySummary } from '@/lib/simple/weekly-summary'
import {
  EMERGENCY_FUND_MONTHS, SHORT_HORIZON_YEARS, GLIDE_FULL_HORIZON_YEARS,
  GLIDE_SHORT_FRACTION, PROFILE_TILT_MAX,
} from '@/lib/config/product-defaults'

const NOW = new Date('2026-11-19T00:00:00Z')
const inYears = (y: number) => new Date(NOW.getTime() + y * 365.25 * 86_400_000).toISOString().slice(0, 10)
const PROFILES = ['vault', 'conservative', 'balanced', 'growth', 'speculative']

// ─── Glide path ──────────────────────────────────────────────────────────────

describe('glide path constants (owner decisions)', () => {
  it('6 months emergency, 2-year short horizon, full share from 10 years, 25% at 2 years, +15 tilt cap', () => {
    expect(EMERGENCY_FUND_MONTHS).toBe(6)
    expect(SHORT_HORIZON_YEARS).toBe(2)
    expect(GLIDE_FULL_HORIZON_YEARS).toBe(10)
    expect(GLIDE_SHORT_FRACTION).toBe(0.25)
    expect(PROFILE_TILT_MAX).toBe(0.15)
  })
})

describe('longHorizonStockShare — profile-anchored, upside capped at balanced + 15', () => {
  it.each([
    ['vault', 0.20], ['conservative', 0.40], ['balanced', 0.60], ['growth', 0.75], ['speculative', 0.75],
  ])('%s → %s', (p, expected) => {
    expect(longHorizonStockShare(p)).toBeCloseTo(expected as number, 10)
  })

  it('never gives a profile MORE stock than its own mix', () => {
    const own: Record<string, number> = { vault: 0.2, conservative: 0.4, balanced: 0.6, growth: 0.8, speculative: 0.9 }
    for (const p of PROFILES) expect(longHorizonStockShare(p)).toBeLessThanOrEqual(own[p] + 1e-12)
  })
})

describe('glideFraction', () => {
  it('1 at 10+ years and for undated goals; 0.25 at 2 years; linear between', () => {
    expect(glideFraction(null)).toBe(1)
    expect(glideFraction(15)).toBe(1)
    expect(glideFraction(10)).toBe(1)
    expect(glideFraction(2)).toBe(0.25)
    expect(glideFraction(6)).toBeCloseTo(0.625, 10)   // halfway
  })

  it('is monotonic: closer goals never hold more stock', () => {
    let prev = Infinity
    for (let y = 12; y >= 2; y -= 0.5) {
      const f = glideFraction(y)
      expect(f).toBeLessThanOrEqual(prev)
      prev = f
    }
  })
})

describe('goalStockShare respects the glide ceiling for every profile and horizon', () => {
  it.each(PROFILES)('%s', (p) => {
    for (const y of [null, 30, 10, 8, 6, 4, 2.5, 2]) {
      expect(goalStockShare(y, p)).toBeLessThanOrEqual(glideCeiling(y) + 1e-12)
    }
  })

  it('balanced: 60% at 10y → 15% at 2y', () => {
    expect(goalStockShare(10, 'balanced')).toBeCloseTo(0.60, 10)
    expect(goalStockShare(2, 'balanced')).toBeCloseTo(0.15, 10)
  })
})

describe('coreStockShare — dollar-weighted blend across goals', () => {
  it('blends each Core goal by its target dollars', () => {
    // $100k at 10y (60%) and $100k at 6y (60% × 0.625 = 37.5%) → 48.75%
    const s = coreStockShare([
      { targetAmountUsd: 100_000, targetDate: inYears(10.01) },
      { targetAmountUsd: 100_000, targetDate: inYears(6) },
    ], 'balanced', NOW)
    expect(s).toBeCloseTo((0.60 + 0.375) / 2, 2)
  })

  it('weights by dollars, not by count', () => {
    const s = coreStockShare([
      { targetAmountUsd: 300_000, targetDate: inYears(20) },
      { targetAmountUsd: 100_000, targetDate: inYears(6) },
    ], 'balanced', NOW)
    expect(s).toBeCloseTo((3 * 0.60 + 1 * 0.375) / 4, 2)
  })

  it('goals inside 2 years are Tier 1, not Core', () => {
    expect(isShortHorizon(yearsUntil(inYears(1), NOW))).toBe(true)
    const s = coreStockShare([
      { targetAmountUsd: 1_000_000, targetDate: inYears(1) },   // ignored
      { targetAmountUsd: 10_000, targetDate: inYears(15) },
    ], 'growth', NOW)
    expect(s).toBeCloseTo(0.75, 10)
  })

  it('no Core goals → the profile’s long-horizon share', () => {
    expect(coreStockShare([], 'conservative', NOW)).toBeCloseTo(0.40, 10)
  })
})

// ─── Ladder ──────────────────────────────────────────────────────────────────

function input(over: Partial<LadderInput> = {}): LadderInput {
  return {
    assets: [{ category: 'stock', current_value: 90_000 }, { category: 'cash', current_value: 30_000 }],
    monthlyExpensesUsd: 4_000,           // → $24,000 emergency fund
    goals: [],
    profileKey: 'balanced',
    exploreCapFraction: null,            // default 10%
    tier1DesignatedUsd: 0,
    exploreInUseUsd: 0,
    now: NOW,
    ...over,
  }
}

describe('computeLadder — Tier 1 Safety', () => {
  it('target = 6 × monthly expenses + the FULL amount of goals due within 2 years', () => {
    const l = computeLadder(input({
      goals: [
        { id: 'a', name: 'Car', targetAmountUsd: 15_000, targetDate: inYears(1) },
        { id: 'b', name: 'House', targetAmountUsd: 80_000, targetDate: inYears(5) },
      ],
    }))
    expect(l.tier1.emergencyUsd).toBe(24_000)
    expect(l.tier1.shortGoalsUsd).toBe(15_000)
    expect(l.tier1.targetUsd).toBe(39_000)
    expect(l.tier1.shortGoals.map(g => g.name)).toEqual(['Car'])
  })

  it('funded when cash-like holdings reach the target; excess cash is NOT Tier 1', () => {
    const l = computeLadder(input())
    expect(l.tier1.status).toBe('funded')
    expect(l.tier1.amountUsd).toBe(24_000)      // min(held 30k, target 24k)
    expect(l.explore.open).toBe(true)
  })

  it('missing monthly expenses → needs_expenses, Explore closed with a plain reason', () => {
    const l = computeLadder(input({ monthlyExpensesUsd: null }))
    expect(l.tier1.status).toBe('needs_expenses')
    expect(l.tier1.targetUsd).toBeNull()
    expect(l.explore.capUsd).toBe(0)
    expect(l.explore.open).toBe(false)
    expect(l.explore.reason).toMatch(/monthly expenses/)
  })

  it('short of target → Explore is $0, reason states held vs needed in dollars', () => {
    const l = computeLadder(input({ assets: [{ category: 'stock', current_value: 90_000 }, { category: 'cash', current_value: 10_000 }] }))
    expect(l.tier1.status).toBe('short')
    expect(l.tier1.shortfallUsd).toBe(14_000)
    expect(l.explore.capUsd).toBe(0)
    expect(l.explore.reason).toContain('$10,000 of the $24,000')
  })

  it('an approved setup designation counts as Tier 1 holdings', () => {
    const l = computeLadder(input({
      assets: [{ category: 'stock', current_value: 90_000 }, { category: 'cash', current_value: 10_000 }],
      tier1DesignatedUsd: 14_000,
    }))
    expect(l.tier1.status).toBe('funded')
  })

  it('real estate is not investable money', () => {
    const l = computeLadder(input({ assets: [
      { category: 'stock', current_value: 90_000 }, { category: 'cash', current_value: 30_000 },
      { category: 'real_estate', current_value: 500_000 },
    ] }))
    expect(l.investableUsd).toBe(120_000)
  })
})

describe('computeLadder — Explore cap on money NOT in Tier 1', () => {
  it('cap = 10% × (investable − Tier 1)', () => {
    const l = computeLadder(input())
    expect(l.explore.baseUsd).toBe(96_000)          // 120k − 24k
    expect(l.explore.capUsd).toBe(9_600)
  })

  it('in-use and left track open Explore notional', () => {
    const l = computeLadder(input({ exploreInUseUsd: 2_500 }))
    expect(l.explore.leftUsd).toBe(7_100)
    // Core's target leaves the Explore reserve aside, whatever is in use now.
    expect(l.core.targetUsd).toBe((120_000 - 24_000) * 0.9)
  })

  it('a pro cap above the hard maximum is clamped', () => {
    const l = computeLadder(input({ exploreCapFraction: 0.9 }))
    expect(l.explore.capFraction).toBe(clampExploreCapFraction(0.9))
  })
})

describe('only REDUCES Explore relative to before (owner ground rule)', () => {
  // Before Phase 2 the cap was capFraction × (sum of ALL recorded assets).
  const cases: Array<Partial<LadderInput>> = [
    {},
    { monthlyExpensesUsd: null },
    { monthlyExpensesUsd: 50_000 },
    { assets: [{ category: 'stock', current_value: 50_000 }, { category: 'real_estate', current_value: 400_000 }] },
    { exploreCapFraction: 0.2 },
    { goals: [{ id: 'g', name: 'G', targetAmountUsd: 60_000, targetDate: inYears(1) }] },
  ]
  it.each(cases.map((c, i) => [i, c] as const))('case %i: new cap ≤ old cap', (_i, c) => {
    const inp = input(c)
    const l = computeLadder(inp)
    const oldCap = clampExploreCapFraction(inp.exploreCapFraction) *
      inp.assets.reduce((s, a) => s + (a.current_value ?? 0), 0)
    expect(l.explore.capUsd).toBeLessThanOrEqual(oldCap + 0.01)
  })
})

describe('ladderSetupAmount', () => {
  it('moves the shortfall, bounded by money available', () => {
    const short = computeLadder(input({ assets: [{ category: 'stock', current_value: 90_000 }, { category: 'cash', current_value: 10_000 }] }))
    expect(ladderSetupAmount(short)).toBe(14_000)
    const tiny = computeLadder(input({ assets: [{ category: 'stock', current_value: 5_000 }], monthlyExpensesUsd: 4_000 }))
    expect(ladderSetupAmount(tiny)).toBe(5_000)    // can't designate money that isn't there
  })
  it('0 when funded or when expenses are unknown', () => {
    expect(ladderSetupAmount(computeLadder(input()))).toBe(0)
    expect(ladderSetupAmount(computeLadder(input({ monthlyExpensesUsd: null })))).toBe(0)
  })
})

// ─── The gate ────────────────────────────────────────────────────────────────

describe('exploreCapVerdict — strict Tier 1 gate', () => {
  const usage = (over: Partial<ExploreUsage>): ExploreUsage => ({
    capFraction: 0.1, totalValueUsd: 100_000, baseUsd: 100_000, capUsd: 10_000,
    usedUsd: 0, leftUsd: 10_000, tier1Funded: true, closedReason: null, ...over,
  })
  it('blocks every Explore trade while Tier 1 is short, with the plain reason', () => {
    const v = exploreCapVerdict(usage({ tier1Funded: false, capUsd: 0, closedReason: 'Your safety cushion has $1 of the $2 it needs.' }), 100)
    expect(v.allowed).toBe(false)
    expect(v.reason).toMatch(/^tier1_unfunded: Your safety cushion/)
  })
  it('allows once funded and inside the cap', () => {
    expect(exploreCapVerdict(usage({}), 100).allowed).toBe(true)
  })
})

// ─── Approval write path ─────────────────────────────────────────────────────

interface Row { [k: string]: unknown }
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  writes: [] as Array<{ table: string; op: string; row: Row }>,
  seq: 0,
}))
vi.mock('@/lib/paper-trading/price-feed', () => ({ fetchCurrentPrice: async () => 100 }))

function chain(table: string): Record<string, unknown> {
  const rows = () => db.tables[table] ?? []
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'not', 'order', 'limit', 'gte']) c[m] = () => c
  c.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null })
  c.insert = (row: Row) => {
    const stored = { id: `r${++db.seq}`, ...row }
    db.writes.push({ table, op: 'insert', row: stored })
    db.tables[table] = [...rows(), stored]
    const res = { error: null }
    return {
      select: () => ({ single: async () => ({ data: { id: stored.id }, error: null }) }),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res).then(ok, bad),
    }
  }
  c.upsert = async (row: Row) => { db.writes.push({ table, op: 'upsert', row }); db.tables[table] = [row]; return { error: null } }
  c.update = (patch: Row) => ({ eq: async () => { db.writes.push({ table, op: 'update', row: patch }); return { error: null } } })
  c.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(res)
  return c
}
const fakeSupabase = { from: (t: string) => chain(t) } as never

describe('approveLadderSetup — approval first, then paper fund buys', () => {
  async function run(summary: string) {
    const { approveLadderSetup } = await import('@/lib/allocation/ladder-data')
    return approveLadderSetup(fakeSupabase, 'u1', summary)
  }
  function seed(expenses: number | null) {
    db.writes = []
    db.seq = 0
    db.tables = {
      assets: [{ category: 'stock', current_value: 90_000 }, { category: 'cash', current_value: 10_000 }],
      financial_profile: expenses == null ? [] : [{ monthly_essential_expenses_usd: expenses }],
    }
  }

  it('refuses without an approved summary', async () => {
    seed(4_000)
    const r = await run('   ')
    expect(r.ok).toBe(false)
    expect(db.writes).toEqual([])
  })

  it('refuses when monthly expenses are unknown', async () => {
    seed(null)
    const r = await run('Set up my safety cushion')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/monthly expenses/)
  })

  it('records the setup_ladder approval BEFORE any paper trade, then funds Safety and Core', async () => {
    seed(4_000)
    const r = await run('Set up my money ladder')
    expect(r.ok).toBe(true)
    const apprIdx = db.writes.findIndex(w => w.table === 'automation_approvals' && w.row.kind === 'setup_ladder')
    const firstBuy = db.writes.findIndex(w => w.table === 'paper_positions')
    expect(apprIdx).toBeGreaterThan(-1)
    expect(firstBuy).toBeGreaterThan(apprIdx)

    // Tier 1: $14k short, grossed up for the purchase cost so it lands FULL.
    expect(r.safetyUsd).toBeGreaterThanOrEqual(14_000)
    expect(r.safetyUsd).toBeLessThan(14_050)
    // Core: (100k − 24k Tier 1 target) × 90% — the Explore reserve stays unplaced.
    expect(r.coreUsd).toBeCloseTo(68_400, 0)

    const buys = db.writes.filter(w => w.table === 'paper_positions').map(w => w.row)
    expect(new Set(buys.map(b => b.strategy_key))).toEqual(new Set(['safety', 'core']))
    expect(buys.every(b => b.status === 'open' && b.direction === 'long')).toBe(true)

    expect(r.ladder?.tier1.status).toBe('funded')
    expect(r.ladder?.core.invested).toBe(true)
    // Nothing counted twice: Safety + Core + unplaced = the money there is.
    const l = r.ladder!
    expect(l.tier1.inFundUsd + l.core.heldUsd + l.unplacedUsd).toBeCloseTo(l.investableUsd, 2)
    expect(l.explore.open).toBe(true)
  })
})

// ─── Plain English, onboarding, migration (contracts) ────────────────────────

const read = (p: string) => readFileSync(join(process.cwd(), ...p.split('/')), 'utf8')

describe('Simple-mode reasons', () => {
  it('the weekly summary explains Tier 1 holds without jargon', () => {
    const items = generateWeeklySummary({
      closes: [], opens: [], halted: false,
      blocked: [{ reason: 'tier1_unfunded: Your safety cushion has $1 of $2' }, { reason: 'tier1_unfunded: x' }],
    })
    expect(items.join(' ')).toContain("safety cushion isn't full yet")
    expect(items.join(' ').toLowerCase()).not.toMatch(/tier1|notional|drawdown/)
  })

  it('the mobile activity feed maps the Tier 1 reason to plain English', () => {
    expect(read('lib/simple/mobile-data.ts')).toMatch(/isTier1Reason\(reason\)\) return "your safety cushion isn't full yet/)
  })

  it('both Explore screens show the closed reason', () => {
    expect(read('app/(app)/traders/traders-client.tsx')).toContain('usage.closedReason')
    expect(read('apps/mobile/app/(tabs)/explore.tsx')).toContain('usage.closedReason')
  })
})

describe('ladder is shown on the web Goal page and the mobile Goals screen', () => {
  it('web /advisor renders the LadderPanel', () => {
    expect(read('app/(app)/advisor/page.tsx')).toContain('<LadderPanel')
  })
  it('mobile Goals renders the LadderCard (with and without a goal)', () => {
    expect(read('apps/mobile/app/(tabs)/goals.tsx').match(/<LadderCard/g)?.length).toBe(2)
  })
  it('ladder decisions come first in both decision lists', () => {
    expect(read('lib/actions/command-center.ts')).toMatch(/\[\.\.\.ladder, \.\.\.\(await loadDecisions/)
    const mobile = read('lib/simple/mobile-data.ts')
    expect(mobile.indexOf("kind: 'ladder_expenses'")).toBeLessThan(mobile.indexOf("kind: 'rebalance'"))
  })
})

describe('onboarding collects monthly expenses', () => {
  it('has an expenses step and saves it before the profile is marked onboarded', () => {
    const src = read('app/onboarding/risk-profile/page.tsx')
    expect(src).toContain('What do you spend each month on the essentials?')
    const exp = src.indexOf('saveOnboardingExpenses(')
    const prof = src.indexOf('saveOnboardedProfile(recommended')
    expect(exp).toBeGreaterThan(-1)
    expect(exp).toBeLessThan(prof)
  })
})

describe('migration 20260704l', () => {
  const sql = read('supabase/migrations/20260704l_ladder.sql')
  it('creates ladder_state with RLS on the owner', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.ladder_state')
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toMatch(/USING \(user_id = auth\.uid\(\)\)/)
  })
  it('allows the setup_ladder approval kind', () => {
    expect(sql).toMatch(/'setup_ladder'/)
  })
})
