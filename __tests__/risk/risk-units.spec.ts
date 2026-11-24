/**
 * Phase 4 — risk units: budget the strategy slice by risk, not dollars.
 *  - volatility: realized with enough history, else conservative default;
 *    binary markets use the stake as max loss; options always default,
 *  - risk units, Explore risk budget, per-position ceiling,
 *  - book caps on risk-unit share as an ADDITIONAL gate (never larger),
 *  - wiring order in the paper runner and the copy executor,
 *  - pro-mode risk page shows risk share next to dollar share.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  toRiskClass, periodsPerYear, defaultVol, realizedVolFromCloses, resolveVol, riskUnits,
  exploreRiskBudget, positionRiskCeilingNotional, capToRiskCeiling, historySymbol, getAnnualVol,
} from '@/lib/risk/risk-units'
import { gateThroughBook, computeBookExposures, summarizeBookExposures } from '@/lib/risk/book-allocation'
import {
  VOL_MIN_OBSERVATIONS, VOL_LOOKBACK_DAYS, DEFAULT_ANNUAL_VOL, VOL_FLOOR_ANNUAL,
  EXPLORE_RISK_REFERENCE_VOL, MAX_POSITION_RISK_SHARE,
} from '@/lib/config/product-defaults'

const read = (p: string) => readFileSync(join(process.cwd(), ...p.split('/')), 'utf8')

/** Closes from a list of daily returns, starting at 100. */
function closesFrom(rets: number[]): number[] {
  const out = [100]
  for (const r of rets) out.push(out[out.length - 1] * (1 + r))
  return out
}
const alternating = (n: number, x: number) => Array.from({ length: n }, (_, i) => (i % 2 ? -x : x))

describe('constants (product defaults)', () => {
  it('have the documented defaults', () => {
    expect(VOL_MIN_OBSERVATIONS).toBe(20)
    expect(VOL_LOOKBACK_DAYS).toBe(90)
    expect(DEFAULT_ANNUAL_VOL).toEqual({ stocks: 0.4, options: 1, crypto: 0.9, forex: 0.15, 'multi-asset': 0.4 })
    expect(VOL_FLOOR_ANNUAL).toBe(0.05)
    expect(EXPLORE_RISK_REFERENCE_VOL).toBe(0.2)
    expect(MAX_POSITION_RISK_SHARE).toBe(0.2)
  })
})

describe('volatility', () => {
  it('maps every asset-class spelling onto a risk class', () => {
    expect(toRiskClass('stock')).toBe('stocks')
    expect(toRiskClass('ETF')).toBe('stocks')
    expect(toRiskClass('crypto')).toBe('crypto')
    expect(toRiskClass('fx')).toBe('forex')
    expect(toRiskClass('polymarket')).toBe('polymarket')
    expect(toRiskClass('option')).toBe('options')
    expect(toRiskClass(undefined)).toBe('multi-asset')
  })
  it('annualizes with 365 periods for crypto, 252 otherwise', () => {
    expect(periodsPerYear('crypto')).toBe(365)
    expect(periodsPerYear('stocks')).toBe(252)
  })
  it('realized vol of ±1% days ≈ 1% × √252', () => {
    const { vol, observations } = realizedVolFromCloses(closesFrom(alternating(40, 0.01)), 'stocks')
    expect(observations).toBe(40)
    expect(vol!).toBeCloseTo(0.01 * Math.sqrt(252) * Math.sqrt(40 / 39), 2)
  })
  it(`uses realized vol only with ≥ ${VOL_MIN_OBSERVATIONS} daily returns`, () => {
    const short = resolveVol('stocks', closesFrom(alternating(VOL_MIN_OBSERVATIONS - 1, 0.01)))
    expect(short).toMatchObject({ source: 'default', vol: DEFAULT_ANNUAL_VOL.stocks })
    const enough = resolveVol('stocks', closesFrom(alternating(VOL_MIN_OBSERVATIONS, 0.01)))
    expect(enough.source).toBe('realized')
    expect(enough.vol).toBeLessThan(DEFAULT_ANNUAL_VOL.stocks)
  })
  it('floors realized vol: a quiet spell is not safety', () => {
    const quiet = resolveVol('forex', closesFrom(alternating(30, 0.0001)))
    expect(quiet.vol).toBe(VOL_FLOOR_ANNUAL)
  })
  it('binary prediction markets: vol 1, so risk units = the stake (max loss)', () => {
    const v = resolveVol('polymarket', closesFrom(alternating(60, 0.01)))
    expect(v).toEqual({ vol: 1, source: 'binary', observations: 0 })
    expect(riskUnits(250, v.vol)).toBe(250)
  })
  it('options always use the conservative default', () => {
    expect(resolveVol('options', closesFrom(alternating(60, 0.001))).vol).toBe(1)
  })
  it('no history at all → the conservative default', () => {
    for (const c of ['stocks', 'crypto', 'forex', 'multi-asset']) {
      expect(resolveVol(c, []).vol).toBe(defaultVol(c))
    }
  })
})

describe('getAnnualVol — network, cached, fail-safe', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('realized from Yahoo daily closes; failure → default', async () => {
    const closes = closesFrom(alternating(30, 0.02))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      chart: { result: [{ indicators: { quote: [{ close: closes }] } }] },
    }))))
    const ok = await getAnnualVol('ZZZT', 'stocks')
    expect(ok.source).toBe('realized')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await getAnnualVol('ZZZU', 'crypto')).toMatchObject({ source: 'default', vol: DEFAULT_ANNUAL_VOL.crypto })
  })
  it('never fetches for binaries or options', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await getAnnualVol('will-it-rain', 'polymarket')
    await getAnnualVol('AAPL240119C00150000', 'options')
    expect(f).not.toHaveBeenCalled()
  })
  it('maps symbols to their daily series', () => {
    expect(historySymbol('BTC', 'crypto')).toBe('BTC-USD')
    expect(historySymbol('ETH-PERP', 'crypto')).toBe('ETH-USD')
    expect(historySymbol('EUR_USD', 'forex')).toBe('EURUSD=X')
    expect(historySymbol('EUR/USD', 'multi-asset')).toBe('EURUSD=X')
    expect(historySymbol('AAPL', 'stocks')).toBe('AAPL')
    expect(historySymbol('x', 'polymarket')).toBeNull()
  })
})

describe('Explore risk budget and the per-position ceiling', () => {
  it('budget = Explore cap × reference vol; one position ≤ 20% of it', () => {
    expect(exploreRiskBudget(10_000)).toBe(2_000)
    // 20% × 2,000 = 400 risk units; at 40% vol that's $1,000 of notional.
    expect(positionRiskCeilingNotional(10_000, 0.4)).toBeCloseTo(1_000, 6)
    // A binary: the stake itself may be at most $400.
    expect(positionRiskCeilingNotional(10_000, 1)).toBeCloseTo(400, 6)
  })
  it('never returns more than proposed (property)', () => {
    for (let i = 0; i < 500; i++) {
      const proposed = Math.random() * 50_000
      const cap = Math.random() * 30_000
      const vol = 0.01 + Math.random() * 2
      const r = capToRiskCeiling(proposed, cap, vol)
      expect(r.notionalUsd).toBeLessThanOrEqual(proposed + 1e-9)
      expect(riskUnits(r.notionalUsd, vol)).toBeLessThanOrEqual(MAX_POSITION_RISK_SHARE * exploreRiskBudget(cap) + 1e-6)
    }
  })
})

describe('gateThroughBook — risk-unit share is an ADDITIONAL gate', () => {
  const base = { strategyKey: 'funding_basis_arb', proposedNotionalUsd: 1_000, regime: 'NEUTRAL' }

  it('without risk inputs it behaves exactly as before', () => {
    for (const [total, book] of [[10_000, 0], [10_000, 1_000], [10_000, 2_900], [0, 0], [5_000, 4_000]]) {
      const a = gateThroughBook({ ...base, totalNotionalUsd: total, bookNotionalUsd: book })
      const b = gateThroughBook({ ...base, totalNotionalUsd: total, bookNotionalUsd: book, proposedVol: undefined })
      expect(b).toEqual(a)
    }
  })

  it('never allows more than the dollar-only gate (property)', () => {
    for (let i = 0; i < 1_000; i++) {
      const total = Math.random() * 50_000
      const book = Math.random() * total
      const totalRisk = Math.random() * 20_000
      const bookRisk = Math.random() * totalRisk
      const vol = 0.05 + Math.random() * 1.5
      const regime = ['RISK_ON', 'NEUTRAL', 'RISK_OFF', 'CRISIS'][i % 4]
      const dollars = gateThroughBook({ ...base, regime, totalNotionalUsd: total, bookNotionalUsd: book })
      const withRisk = gateThroughBook({
        ...base, regime, totalNotionalUsd: total, bookNotionalUsd: book,
        proposedVol: vol, totalRiskUnits: totalRisk, bookRiskUnits: bookRisk,
      })
      expect(withRisk.multiplier).toBeLessThanOrEqual(dollars.multiplier + 1e-12)
      if (!dollars.allowed) expect(withRisk.allowed).toBe(false)
    }
  })

  it('a book of volatile positions hits its cap on risk before dollars', () => {
    // Dollars: 20% of open notional — room left. Risk: the book already holds
    // most of the open risk, and the new position is volatile.
    const dollarsOnly = gateThroughBook({ ...base, totalNotionalUsd: 10_000, bookNotionalUsd: 2_000 })
    const withRisk = gateThroughBook({
      ...base, totalNotionalUsd: 10_000, bookNotionalUsd: 2_000,
      proposedVol: 0.9, totalRiskUnits: 3_000, bookRiskUnits: 1_400,
    })
    expect(dollarsOnly.multiplier).toBe(1)
    expect(withRisk.allowed).toBe(false)
    expect(withRisk.reason).toContain('of open risk')
  })

  it('the empty-portfolio floor is unchanged', () => {
    const r = gateThroughBook({ ...base, totalNotionalUsd: 0, bookNotionalUsd: 0, proposedVol: 1, totalRiskUnits: 0, bookRiskUnits: 0 })
    expect(r.allowed).toBe(true)
  })
})

describe('computeBookExposures — dollars and risk units per book', () => {
  it('sums risk = notional × each position’s own vol, excluding ladder rows', async () => {
    let notArgs: unknown[] = []
    const rows = [
      { strategy_key: 'funding_basis_arb', symbol: 'BTC', asset_class: 'crypto', notional_usd: 1_000 },
      { strategy_key: 'polymarket_base_rate', symbol: 'm1', asset_class: 'polymarket', notional_usd: 200 },
    ]
    const c: Record<string, unknown> = {}
    c.select = () => c
    c.eq = () => c
    c.not = (...a: unknown[]) => { notArgs = a; return c }
    c.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res)
    const sb = { from: () => c } as never
    const vols: Record<string, number> = { crypto: 0.8, polymarket: 1 }
    const s = await computeBookExposures(sb, 'u1', async (_sym, cls) => ({ vol: vols[cls], source: 'default', observations: 0 }))
    expect(notArgs).toEqual(['strategy_key', 'in', '("core","safety")'])
    expect(s.totalNotionalUsd).toBe(1_200)
    expect(s.totalRiskUnits).toBeCloseTo(1_000 * 0.8 + 200, 6)
    const rows2 = summarizeBookExposures(s.totalNotionalUsd, s.byBook, s.totalRiskUnits, s.riskByBook)
    for (const r of rows2) {
      expect(r.utilization).toBeCloseTo(r.capShare > 0 ? Math.max(r.share, r.riskShare) / r.capShare : 0, 9)
    }
    expect(rows2.reduce((t, r) => t + r.riskShare, 0)).toBeCloseTo(1, 9)
  })
})

describe('wiring — additional gates, in the right order', () => {
  it('paper runner: vol → book gate (with risk) → risk ceiling → Explore cap → fill', () => {
    const src = read('lib/paper-trading/PaperTradeRunner.ts')
    const i = (s: string) => src.indexOf(s)
    expect(i('getAnnualVol(opp.symbol')).toBeGreaterThan(-1)
    expect(i('getAnnualVol(opp.symbol')).toBeLessThan(i('gateThroughBook({'))
    expect(src.slice(i('gateThroughBook({'), i('if (!bookGate.allowed)'))).toContain('bookRiskUnits')
    expect(i('capToRiskCeiling(')).toBeGreaterThan(i('gateThroughBook({'))
    expect(i('capToRiskCeiling(')).toBeLessThan(i('exploreCapVerdict(usage'))
    expect(i('exploreCapVerdict(usage')).toBeLessThan(i('broker.fill('))
  })
  it('copy executor: the ceiling shrinks the copy before it is recorded or sent', () => {
    const src = read('lib/workers/copy-trade-executor.ts')
    expect(src.indexOf('capToRiskCeiling(')).toBeGreaterThan(-1)
    expect(src.indexOf('capToRiskCeiling(')).toBeLessThan(src.indexOf("from('user_copied_positions')\n        .insert"))
    expect(src.indexOf('capToRiskCeiling(')).toBeLessThan(src.indexOf('adapter.execute('))
  })
  it('the pro-mode Risk Room shows risk share next to dollar share per book', () => {
    expect(read('app/(app)/risk/page.tsx')).toContain('BookAllocationPanel')
    const panel = read('app/(app)/strategies/BookAllocationPanel.tsx')
    expect(panel).toContain('b.riskShare')
    expect(panel).toContain('b.share')
  })
})
