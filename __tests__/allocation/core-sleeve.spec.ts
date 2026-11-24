/**
 * Phase 3 — make Core real (paper).
 *  - ladder tagging (reserved strategy keys) and the exclusion contract,
 *  - setup / deposit / drift / rebalance plans (safest money first, no double
 *    counting, furthest-below-target fund first, threshold, self-funded),
 *  - paper execution (approval first, FIFO lot split, no-exit seatbelt),
 *  - pause sells Explore only, correlation caps read the real book,
 *  - bad-year dollars from the actual tier mix,
 *  - migration contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CORE_STRATEGY_KEY, SAFETY_STRATEGY_KEY, LADDER_KEYS_FILTER, LADDER_NO_EXIT,
  isLadderKey, sleeveOfKey, strategyRowsOnly,
} from '@/lib/allocation/sleeves'
import { computeLadder, freeUsd, type LadderInput, type LadderHoldings } from '@/lib/allocation/ladder'
import {
  allocateToCore, planLadderSetup, setupNeeded, planDeposit, coreDrift, planCoreRebalance,
  safetyBuyFor, type FundTrade,
} from '@/lib/allocation/core-plans'
import { tierMixOf, blendedMonthlyReturns, yearRangeForMix, mixAfterTrades, badYearFraction } from '@/lib/allocation/bad-year'
import { applyCorrelationCaps, loadCorrelationBook } from '@/lib/risk/correlation-aware-sizing'
import { generateWeeklySummary } from '@/lib/simple/weekly-summary'
import { CORE_DRIFT_THRESHOLD, CORE_MIN_TRADE_USD, CORE_FUNDS } from '@/lib/config/product-defaults'

const NOW = new Date('2026-11-20T00:00:00Z')
const read = (p: string) => readFileSync(join(process.cwd(), ...p.split('/')), 'utf8')

function input(over: Partial<LadderInput> = {}): LadderInput {
  return {
    assets: [{ category: 'stock', current_value: 90_000 }, { category: 'cash', current_value: 10_000 }],
    monthlyExpensesUsd: 4_000,          // → $24,000 Tier 1 target
    goals: [],
    profileKey: 'balanced',             // 60/40 Core
    exploreCapFraction: null,           // 10%
    tier1DesignatedUsd: 0,
    exploreInUseUsd: 0,
    now: NOW,
    ...over,
  }
}
const holdings = (h: Partial<LadderHoldings>): LadderHoldings =>
  ({ safetyUsd: 0, coreBySymbol: {}, ladderPnlUsd: 0, hasCorePositions: false, ...h })
const sum = (ts: FundTrade[], pred: (t: FundTrade) => boolean = () => true) =>
  ts.filter(pred).reduce((s, t) => s + t.usd, 0)

// ─── Tagging ─────────────────────────────────────────────────────────────────

describe('ladder tagging — reserved strategy keys', () => {
  it('core / safety are ladder keys; everything else is Explore', () => {
    expect(isLadderKey(CORE_STRATEGY_KEY)).toBe(true)
    expect(isLadderKey(SAFETY_STRATEGY_KEY)).toBe(true)
    expect(isLadderKey('quant_momentum')).toBe(false)
    expect(isLadderKey(null)).toBe(false)
    expect(sleeveOfKey('core')).toBe('core')
    expect(sleeveOfKey('safety')).toBe('safety')
    expect(sleeveOfKey('pead')).toBe('explore')
  })
  it('PostgREST filter literal and in-memory filter agree', () => {
    expect(LADDER_KEYS_FILTER).toBe('("core","safety")')
    const rows = [{ strategy_key: 'core' }, { strategy_key: 'safety' }, { strategy_key: 'pead' }, { strategy_key: null }]
    expect(strategyRowsOnly(rows).map(r => r.strategy_key)).toEqual(['pead', null])
  })
  it('no stop / target / timeout can ever fire on a fund position', () => {
    expect(LADDER_NO_EXIT.stop_loss_pct).toBe(1)
    expect(LADDER_NO_EXIT.take_profit_pct).toBeGreaterThan(1000)
    expect(LADDER_NO_EXIT.max_hold_hours).toBeLessThan(2 ** 31)    // fits a Postgres integer
    expect(LADDER_NO_EXIT.max_hold_hours).toBeGreaterThan(24 * 365 * 1000)
  })
})

describe('exclusion contract — strategy-level readers never see Core / Safety', () => {
  const STRATEGY_READERS = [
    'lib/learning/loop.ts', 'lib/learning/weights.ts', 'lib/agents/agent-calibration.ts',
    'lib/actions/strategy-metrics.ts', 'lib/actions/shadow-portfolio.ts', 'lib/actions/promotion-readiness.ts',
    'lib/actions/paper-scorecard.ts', 'lib/actions/paper-validation.ts', 'lib/actions/paper-trading.ts',
    'lib/actions/equity-curve.ts', 'lib/admin/paper-trading-queries.ts', 'lib/risk/book-allocation.ts',
    'lib/actions/risk-strip.ts', 'lib/cron/tasks.ts', 'app/api/paper-trading/summary/route.ts',
    'app/api/paper-trading/positions/route.ts', 'app/api/learning/debug/route.ts', 'app/api/learning/backfill/route.ts',
    'lib/risk/correlation-aware-sizing.ts', 'lib/simple/mobile-data.ts', 'lib/allocation/ladder-data.ts',
  ]
  it.each(STRATEGY_READERS)('%s filters ladder rows', (f) => {
    expect(read(f)).toMatch(/LADDER_KEYS_FILTER|strategyRowsOnly/)
  })
  it('exits, the position monitor and the kill switch skip ladder rows', () => {
    const broker = read('lib/paper-trading/PaperBroker.ts')
    const exitFn = broker.slice(broker.indexOf('async checkAndExitPositions'), broker.indexOf('async flattenAllPositions'))
    expect(exitFn).toContain('strategyRowsOnly')
    const flatten = broker.slice(broker.indexOf('async flattenAllPositions'))
    expect(flatten).toContain('strategyRowsOnly')
    const monitor = read('lib/workers/position-monitor.ts')
    expect(monitor).toContain('strategyRowsOnly')
    expect(monitor).toContain('isLadderKey(row.strategy_key)')
    expect(read('lib/risk/kill-switch.ts')).toContain('strategyRowsOnly')
  })
})

// ─── No double counting ──────────────────────────────────────────────────────

describe('computeLadder — fund positions are bought with recorded money, counted once', () => {
  it('all-cash: buying Core with excess cash stops that cash counting as Tier 1', () => {
    const before = computeLadder(input({ assets: [{ category: 'cash', current_value: 100_000 }] }))
    expect(before.tier1.heldUsd).toBe(100_000)
    // After Core buys $68,400 out of that cash:
    const after = computeLadder(input({
      assets: [{ category: 'cash', current_value: 100_000 }],
      holdings: holdings({ coreBySymbol: { VTI: 28_728, VXUS: 12_312, BND: 27_360 }, hasCorePositions: true }),
    }))
    expect(after.unplacedUsd).toBeCloseTo(31_600, 2)
    expect(after.tier1.heldUsd).toBeCloseTo(31_600, 2)
    expect(after.tier1.heldUsd + after.core.heldUsd).toBeCloseTo(100_000, 2)
    expect(after.tier1.status).toBe('funded')
  })
  it('Core target uses the FULL Tier 1 target, so a short Tier 1 never inflates it', () => {
    const l = computeLadder(input())            // Tier 1 short: 10k of 24k
    expect(l.tier1.status).toBe('short')
    expect(l.core.targetUsd).toBe((100_000 - 24_000) * 0.9)
  })
  it('market gains on Core raise investable but never the Explore cap', () => {
    const base = computeLadder(input({ assets: [{ category: 'cash', current_value: 100_000 }] }))
    const gained = computeLadder(input({
      assets: [{ category: 'cash', current_value: 100_000 }],
      holdings: holdings({ coreBySymbol: { VTI: 40_000 }, ladderPnlUsd: 20_000, hasCorePositions: true }),
    }))
    expect(gained.investableUsd).toBe(120_000)
    expect(gained.explore.capUsd).toBeLessThanOrEqual(base.explore.capUsd)
  })
  it('deposits are book money: they enlarge funding but are not P&L', () => {
    const l = computeLadder(input({ depositsUsd: 5_000 }))
    expect(l.fundingUsd).toBe(105_000)
    expect(l.depositsUsd).toBe(5_000)
    expect(l.ladderPnlUsd).toBe(0)
  })
})

// ─── Plans ───────────────────────────────────────────────────────────────────

describe('planLadderSetup — safest money first', () => {
  it('fills Tier 1 (grossed up for cost) then Core, within free money', () => {
    const l = computeLadder(input())
    const trades = planLadderSetup(l)
    const safety = sum(trades, t => t.sleeve === 'safety')
    expect(trades[0]).toMatchObject({ sleeve: 'safety', symbol: CORE_FUNDS.cashLike, side: 'buy' })
    expect(safety).toBe(safetyBuyFor(14_000))
    expect(safety).toBeGreaterThan(14_000)
    expect(sum(trades, t => t.sleeve === 'core')).toBeCloseTo(68_400, 1)
    expect(sum(trades)).toBeLessThanOrEqual(freeUsd(l) + 0.01)
    expect(trades.every(t => t.side === 'buy')).toBe(true)
  })
  it('never buys Core while Tier 1 cannot be filled', () => {
    const l = computeLadder(input({ assets: [{ category: 'stock', current_value: 15_000 }] }))
    const trades = planLadderSetup(l)
    expect(trades.map(t => t.sleeve)).toEqual(['safety'])
    expect(trades[0].usd).toBe(15_000)       // everything free, still short
  })
  it('all-cash: Core is funded from cash beyond the Tier 1 target, never from the cash-like fund', () => {
    const l = computeLadder(input({ assets: [{ category: 'cash', current_value: 100_000 }] }))
    const trades = planLadderSetup(l)
    expect(trades.some(t => t.sleeve === 'safety')).toBe(false)
    expect(sum(trades)).toBeCloseTo(68_400, 1)
    expect(sum(trades)).toBeLessThanOrEqual(100_000 - 24_000)
    // With $30k already in the cash-like fund and $70k cash, Core still can't
    // spend the fund: budget = recorded cash beyond target.
    const l2 = computeLadder(input({ assets: [{ category: 'cash', current_value: 100_000 }], holdings: holdings({ safetyUsd: 30_000 }) }))
    expect(sum(planLadderSetup(l2))).toBeLessThanOrEqual(l2.unplacedUsd + 0.01)
  })
  it('nothing to plan without monthly expenses', () => {
    expect(planLadderSetup(computeLadder(input({ monthlyExpensesUsd: null })))).toEqual([])
  })
  it('setupNeeded: first setup yes; invested and on target no; new money recorded yes', () => {
    expect(setupNeeded(computeLadder(input()))).toBe(true)
    const invested = holdings({ safetyUsd: 14_000, coreBySymbol: { VTI: 28_728, VXUS: 12_312, BND: 27_360 }, hasCorePositions: true })
    expect(setupNeeded(computeLadder(input({ holdings: invested })))).toBe(false)
    const more = computeLadder(input({
      assets: [{ category: 'stock', current_value: 190_000 }, { category: 'cash', current_value: 10_000 }],
      holdings: invested,
    }))
    expect(setupNeeded(more)).toBe(true)
  })
  it('a tiny safety shortfall is topped up at the minimum trade, so Explore can reopen', () => {
    expect(safetyBuyFor(3)).toBe(CORE_MIN_TRADE_USD)
    expect(safetyBuyFor(0)).toBe(0)
  })
})

describe('planDeposit — Tier 1 first, then the fund furthest below target', () => {
  it('fills the Tier 1 shortfall before any Core fund', () => {
    const p = planDeposit(computeLadder(input()), 5_000)
    expect(p.tier1Usd).toBe(5_000)
    expect(p.coreUsd).toBe(0)
    expect(p.trades).toEqual([{ sleeve: 'safety', symbol: 'SGOV', side: 'buy', usd: 5_000 }])
  })
  it('once Tier 1 is full, the largest Core gap is filled first', () => {
    const l = computeLadder(input({
      assets: [{ category: 'cash', current_value: 100_000 }],
      holdings: holdings({ coreBySymbol: { VTI: 28_728, VXUS: 12_312, BND: 17_360 }, hasCorePositions: true }),
    }))
    const p = planDeposit(l, 4_000)
    expect(p.tier1Usd).toBe(0)
    expect(p.trades[0]).toMatchObject({ symbol: 'BND', side: 'buy' })
    expect(sum(p.trades)).toBeCloseTo(4_000, 2)
  })
  it('allocateToCore spreads money left after every gap by target weight', () => {
    const funds = computeLadder(input()).core.funds.map(f => ({ ...f, heldUsd: f.targetUsd }))
    const t = allocateToCore(funds, 1_000)
    expect(sum(t)).toBeCloseTo(1_000, 2)
    expect(t.find(x => x.symbol === 'BND')!.usd).toBeCloseTo(400, 2)
  })
})

describe('coreDrift / planCoreRebalance', () => {
  const at = (vti: number, vxus: number, bnd: number) => computeLadder(input({
    assets: [{ category: 'cash', current_value: 100_000 }],
    holdings: holdings({ coreBySymbol: { VTI: vti, VXUS: vxus, BND: bnd }, hasCorePositions: true }),
  }))
  it(`threshold is ${CORE_DRIFT_THRESHOLD * 100} points (product default)`, () => {
    expect(CORE_DRIFT_THRESHOLD).toBe(0.05)
  })
  it('within the threshold → no decision', () => {
    // 64% stocks vs 60% target = 4 points
    expect(coreDrift(at(44_800, 19_200, 36_000)).needsRebalance).toBe(false)
  })
  it('past the threshold → a decision, and the plan is self-funded with sells first', () => {
    const l = at(49_000, 21_000, 30_000)    // 70% stocks
    const d = coreDrift(l)
    expect(d.needsRebalance).toBe(true)
    expect(d.driftStock).toBeCloseTo(0.10, 6)
    const plan = planCoreRebalance(l)
    expect(plan[0].side).toBe('sell')
    expect(sum(plan, t => t.side === 'sell')).toBeCloseTo(sum(plan, t => t.side === 'buy'), 2)
    expect(plan.every(t => t.sleeve === 'core')).toBe(true)
  })
  it('never a decision before Core is invested', () => {
    expect(coreDrift(computeLadder(input())).needsRebalance).toBe(false)
  })
})

// ─── Bad year from the actual tier mix ───────────────────────────────────────

describe('bad-year dollars from the actual tier mix', () => {
  // 3 years of synthetic months: one losing year, then two good ones. Stocks
  // swing hard, bonds barely move.
  const stock = Array.from({ length: 36 }, (_, i) => (i < 12 ? -0.03 : 0.02))
  const bond = Array.from({ length: 36 }, (_, i) => (i < 12 ? -0.003 : 0.003))

  it('Safety does not drop: an all-cash mix has no bad-year loss', () => {
    const r = yearRangeForMix({ cashUsd: 50_000, stocksUsd: 0, bondsUsd: 0, otherUsd: 0 }, stock, bond)
    expect(r!.badYearUsd).toBe(0)
  })
  it('a 60/40 Core loses less in a bad year than all stocks', () => {
    const allStock = yearRangeForMix({ cashUsd: 0, stocksUsd: 100_000, bondsUsd: 0, otherUsd: 0 }, stock, bond)!
    const mixed = yearRangeForMix({ cashUsd: 0, stocksUsd: 60_000, bondsUsd: 40_000, otherUsd: 0 }, stock, bond)!
    expect(mixed.badYearUsd).toBeGreaterThan(allStock.badYearUsd)   // both negative
  })
  it('no bond series → bonds move like stocks (overstates, never understates)', () => {
    const mix = { cashUsd: 0, stocksUsd: 60_000, bondsUsd: 40_000, otherUsd: 0 }
    expect(blendedMonthlyReturns(mix, stock, [])).toEqual(stock.map(r => r))
  })
  it('tierMixOf reads the ladder: Safety = cash, Core funds by class, rest stock-like', () => {
    const l = computeLadder(input({
      assets: [{ category: 'cash', current_value: 100_000 }],
      holdings: holdings({ coreBySymbol: { VTI: 28_728, VXUS: 12_312, BND: 27_360 }, hasCorePositions: true }),
    }))
    const m = tierMixOf(l)
    expect(m.stocksUsd).toBeCloseTo(41_040, 2)
    expect(m.bondsUsd).toBeCloseTo(27_360, 2)
    expect(m.cashUsd + m.stocksUsd + m.bondsUsd + m.otherUsd).toBeCloseTo(l.investableUsd, 2)
  })
  it('the setup lowers the bad-year drop when it moves stock-like money to cash', () => {
    const l = computeLadder(input())
    const before = tierMixOf(l)
    const after = mixAfterTrades(before, [{ sleeve: 'safety', symbol: 'SGOV', side: 'buy', usd: 14_000 }], l)
    expect(after.cashUsd).toBe(before.cashUsd + 14_000)
    expect(badYearFraction(after, stock, bond)!).toBeGreaterThan(badYearFraction(before, stock, bond)!)
  })
})

// ─── Weekly summary, pause, correlation caps ─────────────────────────────────

describe('weekly summary mentions approved fund moves in plain words', () => {
  it('buys and rebalances', () => {
    const buys = generateWeeklySummary({ closes: [], opens: [], blocked: [], halted: false,
      fundMoves: { safetyBoughtUsd: 14_000, coreBoughtUsd: 68_400, coreSoldUsd: 0 } })
    expect(buys[0]).toBe('Put $14,000 into your safety cushion and $68,400 into your long-term core funds, as you approved.')
    const reb = generateWeeklySummary({ closes: [], opens: [], blocked: [], halted: false,
      fundMoves: { safetyBoughtUsd: 0, coreBoughtUsd: 5_000, coreSoldUsd: 5_000 } })
    expect(reb[0]).toMatch(/^Rebalanced your core funds/)
  })
})

describe('pause sells Explore only', () => {
  it('copy on web and phone says Core and Safety are never sold', () => {
    expect(read('components/layout/risk-strip.tsx')).toContain('never sold by a halt')
    expect(read('apps/mobile/app/pause.tsx')).toContain('never sold by a pause')
    expect(read('lib/simple/mobile-data.ts')).toMatch(/buildPauseImpact[\s\S]*LADDER_KEYS_FILTER/)
  })
})

describe('correlation caps read the real open strategy book', () => {
  it('loads paper strategy + copied positions with their own asset class and excludes ladder rows', async () => {
    const calls: Array<{ table: string; not?: unknown[] }> = []
    const data: Record<string, unknown[]> = {
      paper_positions: [{ strategy_key: 'funding_basis_arb', asset_class: 'crypto', notional_usd: 3_000 }],
      user_copied_positions: [{ strategy_key: 'quant_momentum', asset_class: 'stocks', notional_value: '2000' }],
    }
    const sb = {
      from: (table: string) => {
        const call: { table: string; not?: unknown[] } = { table }
        calls.push(call)
        const c: Record<string, unknown> = {}
        c.select = () => c
        c.eq = () => c
        c.not = (...args: unknown[]) => { call.not = args; return c }
        c.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: data[table], error: null }).then(res)
        return c
      },
    }
    const book = await loadCorrelationBook(sb as never, 'u1')
    expect(book).toEqual([
      { strategyKey: 'funding_basis_arb', assetClass: 'crypto', notionalUsd: 3_000 },
      { strategyKey: 'quant_momentum', assetClass: 'stocks', notionalUsd: 2_000 },
    ])
    expect(calls.find(c => c.table === 'paper_positions')!.not).toEqual(['strategy_key', 'in', LADDER_KEYS_FILTER])
  })
  it('a real book makes the caps bind (they only ever reduce)', () => {
    const book = [{ strategyKey: 'funding_basis_arb' as never, assetClass: 'crypto' as never, notionalUsd: 45_000 }]
    const r = applyCorrelationCaps('etf_basis_arb' as never, 'crypto' as never, 20_000, 100_000, book)
    expect(r.notionalUsd).toBeLessThan(20_000)
    expect(r.capApplied).not.toBeNull()
  })
  it('the engine no longer reads the non-existent size_notional_usd column', () => {
    const src = read('lib/agents/cio-decision-engine.ts')
    expect(src).not.toContain('size_notional_usd')
    expect(src).toContain('loadCorrelationBook')
  })
})

// ─── Paper execution ─────────────────────────────────────────────────────────

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  writes: [] as Array<{ table: string; op: string; row: Record<string, unknown>; id?: string }>,
  seq: 0,
}))
vi.mock('@/lib/paper-trading/price-feed', () => ({ fetchCurrentPrice: async () => 100 }))

function fakeClient() {
  return {
    from: (table: string) => {
      const filters: Array<[string, unknown]> = []
      const rows = () => (db.tables[table] ?? []).filter(r => filters.every(([k, v]) =>
        Array.isArray(v) ? v.includes(r[k]) : r[k] === v))
      const c: Record<string, unknown> = {}
      c.select = () => c
      c.eq = (k: string, v: unknown) => { filters.push([k, v]); return c }
      c.in = (k: string, v: unknown[]) => { filters.push([k, v]); return c }
      for (const m of ['not', 'order', 'limit', 'gte', 'or']) c[m] = () => c
      c.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null })
      c.insert = (row: Record<string, unknown>) => {
        const stored = { id: `r${++db.seq}`, opened_at: new Date(Date.now() + db.seq).toISOString(), ...row }
        db.tables[table] = [...(db.tables[table] ?? []), stored]
        db.writes.push({ table, op: 'insert', row: stored })
        const res = { error: null }
        return {
          select: () => ({ single: async () => ({ data: { id: stored.id }, error: null }) }),
          then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res).then(ok, bad),
        }
      }
      c.update = (patch: Record<string, unknown>) => ({
        eq: async (_k: string, id: string) => {
          const r = (db.tables[table] ?? []).find(x => x.id === id)
          if (r) Object.assign(r, patch)
          db.writes.push({ table, op: 'update', row: patch, id })
          return { error: null }
        },
      })
      c.upsert = async (row: Record<string, unknown>) => { db.writes.push({ table, op: 'upsert', row }); return { error: null } }
      c.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(res)
      return c
    },
  } as never
}

beforeEach(() => { db.tables = {}; db.writes = []; db.seq = 0 })

describe('executeFundTrades — paper only, tagged, no exits', () => {
  it('a buy opens a tagged long position with the no-exit seatbelt', async () => {
    const { executeFundTrades } = await import('@/lib/allocation/core-trading')
    const r = await executeFundTrades(fakeClient(), 'u1', [{ sleeve: 'core', symbol: 'VTI', side: 'buy', usd: 1_000 }], 'setup')
    expect(r.failures).toEqual([])
    const pos = db.tables.paper_positions[0]
    expect(pos).toMatchObject({ user_id: 'u1', strategy_key: 'core', symbol: 'VTI', direction: 'long', status: 'open', notional_usd: 1_000 })
    expect(pos).toMatchObject(LADDER_NO_EXIT)
    expect(Number(pos.entry_price)).toBeGreaterThan(100)    // cost applied to the fill
  })
  it('a partial sell splits the oldest lot: sold part closed with realized P&L, remainder stays open', async () => {
    const { executeFundTrades } = await import('@/lib/allocation/core-trading')
    db.tables.paper_positions = [
      { id: 'lot1', user_id: 'u1', strategy_key: 'core', symbol: 'VTI', status: 'open', quantity: 10, entry_price: 90, notional_usd: 900, opened_at: '2026-01-01' },
      { id: 'lot2', user_id: 'u1', strategy_key: 'core', symbol: 'VTI', status: 'open', quantity: 10, entry_price: 95, notional_usd: 950, opened_at: '2026-02-01' },
    ]
    const r = await executeFundTrades(fakeClient(), 'u1', [{ sleeve: 'core', symbol: 'VTI', side: 'sell', usd: 500 }], 'rebalance')
    expect(r.failures).toEqual([])
    const lot1 = db.tables.paper_positions.find(p => p.id === 'lot1')!
    expect(lot1.status).toBe('open')
    expect(lot1.quantity).toBeCloseTo(5, 6)
    const sold = db.tables.paper_positions.find(p => (p.metadata as Record<string, unknown> | undefined)?.split_from === 'lot1')!
    expect(sold.status).toBe('closed')
    expect(sold.quantity).toBeCloseTo(5, 6)
    expect(Number(sold.realized_pnl_usd)).toBeGreaterThan(0)      // bought at 90, sold ~100
    expect(sold.exit_reason).toBe('rebalance')
    expect(db.tables.paper_positions.find(p => p.id === 'lot2')!.quantity).toBe(10)   // untouched
  })
  it('refuses to sell more than is held', async () => {
    const { executeFundTrades } = await import('@/lib/allocation/core-trading')
    const r = await executeFundTrades(fakeClient(), 'u1', [{ sleeve: 'core', symbol: 'BND', side: 'sell', usd: 500 }], 'rebalance')
    expect(r.failures[0]).toMatch(/not enough BND/)
  })
  it('mark-to-market refreshes price and P&L only — never opens or closes', async () => {
    const { markLadderPositions } = await import('@/lib/allocation/core-trading')
    db.tables.paper_positions = [
      { id: 'a', user_id: 'u1', strategy_key: 'core', symbol: 'VTI', status: 'open', quantity: 10, entry_price: 90, notional_usd: 900 },
      { id: 'b', user_id: 'u1', strategy_key: 'pead', symbol: 'XYZ', status: 'open', quantity: 1, entry_price: 50, notional_usd: 50 },
    ]
    const r = await markLadderPositions(fakeClient())
    expect(r.marked).toBe(1)
    const a = db.tables.paper_positions.find(p => p.id === 'a')!
    expect(a.current_price).toBe(100)
    expect(a.unrealized_pnl_usd).toBe(100)
    expect(a.status).toBe('open')
    expect(db.writes.every(w => w.op === 'update' && !('status' in w.row))).toBe(true)
    expect(db.tables.paper_positions.find(p => p.id === 'b')!.current_price).toBeUndefined()
  })
})

describe('deposits and Core rebalance go through the approval-first cores', () => {
  function seed(core?: Record<string, number>) {
    db.tables.assets = [{ category: 'cash', current_value: 100_000 }]
    db.tables.financial_profile = [{ monthly_essential_expenses_usd: 4_000 }]
    if (core) {
      db.tables.paper_positions = Object.entries(core).map(([symbol, usd], i) => ({
        id: `c${i}`, user_id: 'u1', strategy_key: 'core', symbol, status: 'open',
        quantity: usd / 100, entry_price: 100, current_price: 100, notional_usd: usd, opened_at: `2026-0${i + 1}-01`,
      }))
    }
  }
  it('a deposit is recorded first, then fills Safety/Core', async () => {
    const { depositFunds } = await import('@/lib/allocation/ladder-data')
    seed({ VTI: 28_728, VXUS: 12_312, BND: 17_360 })
    const r = await depositFunds(fakeClient(), 'u1', 4_000)
    expect(r.ok).toBe(true)
    const depIdx = db.writes.findIndex(w => w.table === 'paper_deposits')
    const buyIdx = db.writes.findIndex(w => w.table === 'paper_positions' && w.op === 'insert')
    expect(depIdx).toBeGreaterThan(-1)
    expect(buyIdx).toBeGreaterThan(depIdx)
    expect(r.coreUsd).toBeCloseTo(4_000, 2)
  })
  it('rejects a non-positive deposit without writing', async () => {
    const { depositFunds } = await import('@/lib/allocation/ladder-data')
    const r = await depositFunds(fakeClient(), 'u1', 0)
    expect(r.ok).toBe(false)
    expect(db.writes).toEqual([])
  })
  it('Core rebalance refuses inside the threshold and records approval before trading past it', async () => {
    const { approveCoreRebalance } = await import('@/lib/allocation/ladder-data')
    seed({ VTI: 28_728, VXUS: 12_312, BND: 27_360 })     // exactly 60/40
    const refused = await approveCoreRebalance(fakeClient(), 'u1', 'Rebalance my core funds')
    expect(refused.ok).toBe(false)
    expect(db.writes.filter(w => w.table === 'automation_approvals')).toEqual([])

    db.tables = {}; db.writes = []
    seed({ VTI: 49_000, VXUS: 21_000, BND: 30_000 })      // 70% stocks
    const ok = await approveCoreRebalance(fakeClient(), 'u1', 'Rebalance my core funds')
    expect(ok.failures).toEqual([])
    const apprIdx = db.writes.findIndex(w => w.table === 'automation_approvals' && w.row.kind === 'core_rebalance')
    const tradeIdx = db.writes.findIndex(w => w.table === 'paper_positions')
    expect(apprIdx).toBeGreaterThan(-1)
    expect(tradeIdx).toBeGreaterThan(apprIdx)
  })
  it('requires a summary', async () => {
    const { approveCoreRebalance } = await import('@/lib/allocation/ladder-data')
    const r = await approveCoreRebalance(fakeClient(), 'u1', '  ')
    expect(r.error).toMatch(/approval_required/)
  })
})

// ─── Migration contract ──────────────────────────────────────────────────────

describe('migration 20260704m_core_positions.sql', () => {
  const sql = read('supabase/migrations/20260704m_core_positions.sql')
  it('widens exit reasons for the pause close-out and Core lot sells', () => {
    expect(sql).toMatch(/'manual_flatten'/)
    expect(sql).toMatch(/'rebalance'/)
  })
  it('paper_deposits has RLS scoped to the owner', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.paper_deposits')
    expect(sql).toContain('ALTER TABLE public.paper_deposits ENABLE ROW LEVEL SECURITY')
    expect(sql).toMatch(/WITH CHECK \(user_id = auth\.uid\(\)\)/)
  })
  it('approval kinds keep every earlier kind and add core_rebalance + deposit', () => {
    for (const k of ['enable_strategy', 'follow_trader', 'auto_copy', 'accept_rebalance', 'setup_ladder', 'core_rebalance', 'deposit']) {
      expect(sql).toContain(`'${k}'`)
    }
  })
  it('users may log ONLY their own ladder trades', () => {
    expect(sql).toMatch(/FOR INSERT\s+WITH CHECK \(auth\.uid\(\) = user_id AND strategy_key IN \('core','safety'\)\)/)
  })
})
