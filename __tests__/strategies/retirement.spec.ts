/**
 * Roadmap #4 — retire losing strategies automatically.
 *  - "edge beyond luck": Bonferroni-corrected t-test, opt-in promotion gate,
 *  - weekly gate snapshots and the failing-gates streak,
 *  - the benchmark rule, now NET of fees; the evidence deadline,
 *  - the weekly job: switch-off only (paper_enabled false), logged, alerted,
 *    re-enabled strategies start fresh, never a maturity change,
 *  - ops alerts now use the alerts table's real shape.
 */

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { normalQuantile, luckThreshold, tStat } from '@/lib/strategies/luck'
import { evaluatePaperToLive, MIN_CLOSED_TRADES, MAX_DRAWDOWN } from '@/lib/strategies/promotion-gates'
import { weekOf, weeklyGateSnapshot, retirementVerdict, type RetirementInput } from '@/lib/strategies/retirement'
import { generateWeeklySummary } from '@/lib/simple/weekly-summary'
import { roundTripCostBps } from '@/lib/costs/transaction-costs'
import {
  RETIRE_MIN_TRADES_PER_QUARTER, RETIRE_FAIL_WEEKS, RETIRE_EVIDENCE_DEADLINE_DAYS, LUCK_FAMILY_ALPHA,
} from '@/lib/config/product-defaults'
import type { ClosedTradeRow } from '@/lib/strategies/track-record'

const read = (p: string) => readFileSync(join(process.cwd(), ...p.split('/')), 'utf8')
const NOW = new Date('2026-11-23T05:00:00Z')   // a Monday

describe('constants (product defaults)', () => {
  it('have the documented defaults', () => {
    expect(RETIRE_MIN_TRADES_PER_QUARTER).toBe(5)
    expect(RETIRE_FAIL_WEEKS).toBe(8)
    expect(RETIRE_EVIDENCE_DEADLINE_DAYS).toBe(365)
    expect(LUCK_FAMILY_ALPHA).toBe(0.05)
    expect(MIN_CLOSED_TRADES).toBe(30)
    expect(MAX_DRAWDOWN).toBe(0.15)
  })
})

// ─── Luck ────────────────────────────────────────────────────────────────────

describe('edge beyond luck', () => {
  it('inverse normal matches known quantiles', () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 9)
    expect(normalQuantile(0.95)).toBeCloseTo(1.644854, 5)
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5)
    expect(normalQuantile(0.001)).toBeCloseTo(-3.090232, 5)
  })
  it('the bar rises with the number of strategies tested (Bonferroni)', () => {
    expect(luckThreshold(1)).toBeCloseTo(1.6449, 3)
    expect(luckThreshold(62)).toBeCloseTo(normalQuantile(1 - 0.05 / 62), 9)
    expect(luckThreshold(62)).toBeGreaterThan(3.1)
  })
  it('t-statistic of the mean', () => {
    expect(tStat([1, 1, 1])).toBeNull()               // no spread
    expect(tStat([1])).toBeNull()
    expect(tStat([1, 2, 3])).toBeCloseTo(2 / (1 / Math.sqrt(3)), 9)
  })

  const fee = roundTripCostBps('stocks') / 10_000
  const stats = (returns: number[]) => ({
    closedTrades: returns.length, avgReturnPct: returns.reduce((s, v) => s + v, 0) / returns.length,
    maxDrawdownPct: 0.05, assetClass: 'stocks', tradeReturnsPct: returns,
  })
  const noShadow = { shadowAvgReturnPct: null, closedShadowTrades: 0 }
  const strong = Array.from({ length: 60 }, (_, i) => fee + 0.01 + (i % 2 ? 0.004 : -0.004))
  const lucky = Array.from({ length: 60 }, (_, i) => fee + 0.008 + (i % 2 ? 0.03 : -0.03))   // t ≈ 2.05

  it('is opt-in: existing callers keep exactly their five gates', () => {
    const r = evaluatePaperToLive('x', { closedTrades: 40, avgReturnPct: 0.01, maxDrawdownPct: 0.05, assetClass: 'stocks' }, 0.1, noShadow)
    expect(r.criteria.map(c => c.name)).toEqual(['Sample size', 'Net expectancy', 'Calibration', 'Drawdown', 'Shadow check'])
  })
  it('a strong, steady edge passes even across 62 strategies', () => {
    const c = evaluatePaperToLive('x', { ...stats(strong), strategiesTested: 62 }, 0.1, noShadow).criteria.find(x => x.name === 'Edge beyond luck')!
    expect(c).toMatchObject({ evaluable: true, pass: true })
  })
  it('a small, noisy edge that would pass alone fails once 62 strategies are tested', () => {
    const alone = evaluatePaperToLive('x', { ...stats(lucky), strategiesTested: 1 }, 0.1, noShadow).criteria.find(x => x.name === 'Edge beyond luck')!
    const many = evaluatePaperToLive('x', { ...stats(lucky), strategiesTested: 62 }, 0.1, noShadow).criteria.find(x => x.name === 'Edge beyond luck')!
    const t = tStat(lucky.map(r => r - fee))!
    expect(t).toBeGreaterThan(luckThreshold(1))
    expect(t).toBeLessThan(luckThreshold(62))
    expect(alone.pass).toBe(true)
    expect(many.pass).toBe(false)
  })
  it('needs the promotion minimum of trades', () => {
    const c = evaluatePaperToLive('x', { ...stats(strong.slice(0, 10)), strategiesTested: 5 }, 0.1, noShadow).criteria.find(x => x.name === 'Edge beyond luck')!
    expect(c.evaluable).toBe(false)
  })
})

// ─── Rules ───────────────────────────────────────────────────────────────────

const day = (iso: string, plusDays: number) => new Date(new Date(iso).getTime() + plusDays * 86_400_000).toISOString()
function trades(n: number, pct: number, startIso = '2026-05-01T15:00:00Z', stepDays = 1): ClosedTradeRow[] {
  return Array.from({ length: n }, (_, i) => ({
    strategy_key: 's', realized_pnl_pct: pct, realized_pnl_usd: pct * 1_000, notional_usd: 1_000,
    opened_at: day(startIso, i * stepDays), closed_at: day(startIso, i * stepDays + 0.5),
  }))
}
const base = (over: Partial<RetirementInput> = {}): RetirementInput => ({
  strategyKey: 'quant_momentum', assetClass: 'stocks', trades: [], benchmark: null,
  priorSnapshots: [], windowStart: '2026-04-01T00:00:00Z', now: NOW, ...over,
})

describe('weekly gate snapshot', () => {
  it('weekOf is the Monday (UTC)', () => {
    expect(weekOf(new Date('2026-11-23T05:00:00Z'))).toBe('2026-11-23')
    expect(weekOf(new Date('2026-11-29T23:00:00Z'))).toBe('2026-11-23')   // Sunday
  })
  it('not judged before the promotion minimum of trades', () => {
    expect(weeklyGateSnapshot(base({ trades: trades(MIN_CLOSED_TRADES - 1, -0.01) })).failing).toBeNull()
  })
  it('fails on negative after-cost expectancy; passes a healthy record', () => {
    expect(weeklyGateSnapshot(base({ trades: trades(40, -0.002) })).failing).toBe(true)
    const healthy = trades(40, 0.01).map((t, i) => ({ ...t, realized_pnl_pct: i % 5 === 0 ? -0.005 : 0.01, realized_pnl_usd: i % 5 === 0 ? -5 : 10 }))
    expect(weeklyGateSnapshot(base({ trades: healthy })).failing).toBe(false)
  })
  it('fails on a drawdown beyond the gate even with a positive average', () => {
    const rows = [...trades(20, 0.02), ...trades(12, -0.03, '2026-06-01T15:00:00Z'), ...trades(10, 0.05, '2026-07-01T15:00:00Z')]
    const snap = weeklyGateSnapshot(base({ trades: rows }))
    expect(snap.maxDrawdownPct!).toBeGreaterThan(MAX_DRAWDOWN)
    expect(snap.failing).toBe(true)
  })
})

describe('retirement rules', () => {
  const failingWeeks = (n: number) => Array.from({ length: n }, (_, i) => ({
    week: new Date(Date.UTC(2026, 10, 16) - i * 7 * 86_400_000).toISOString().slice(0, 10), failing: true,
  }))

  it(`switches off after ${RETIRE_FAIL_WEEKS} failing weeks in a row`, () => {
    const v = retirementVerdict(base({ trades: trades(40, -0.002), priorSnapshots: failingWeeks(RETIRE_FAIL_WEEKS - 1) }))
    expect(v).toMatchObject({ retire: true, rule: 'gate_failure_streak', streakWeeks: RETIRE_FAIL_WEEKS })
  })
  it('one week short is a warning, not a switch-off', () => {
    const v = retirementVerdict(base({ trades: trades(40, -0.002), priorSnapshots: failingWeeks(RETIRE_FAIL_WEEKS - 2) }))
    expect(v.retire).toBe(false)
    expect(v.reason).toMatch(new RegExp(`${RETIRE_FAIL_WEEKS - 1} of ${RETIRE_FAIL_WEEKS} weeks`))
  })
  it('a passing week breaks the streak', () => {
    const snaps = failingWeeks(RETIRE_FAIL_WEEKS)
    snaps[2] = { ...snaps[2], failing: false }
    expect(retirementVerdict(base({ trades: trades(40, -0.002), priorSnapshots: snaps })).streakWeeks).toBe(3)
  })
  it('benchmark rule is NET of fees: beating the index only before costs still retires', () => {
    const fee = roundTripCostBps('stocks') / 10_000
    // Q2 and Q3 2026: 10 trades each; gross sum 10 × 0.0015 = 1.5% vs benchmark 1.0%.
    const rows = [...trades(10, 0.0015, '2026-04-10T15:00:00Z'), ...trades(10, 0.0015, '2026-07-10T15:00:00Z')]
    const bench = new Map([['2026-Q2', 1.0], ['2026-Q3', 1.0]])
    expect(10 * 0.0015 * 100).toBeGreaterThan(1.0)                       // gross beats it
    expect(10 * (0.0015 - fee) * 100).toBeLessThan(1.0)                  // net doesn't
    const v = retirementVerdict(base({ trades: rows, benchmark: bench }))
    expect(v).toMatchObject({ retire: true, rule: 'benchmark_two_quarters' })
  })
  it('an unmeasured benchmark never retires anything by the benchmark rule', () => {
    const rows = [...trades(10, -0.01, '2026-04-10T15:00:00Z'), ...trades(10, -0.01, '2026-07-10T15:00:00Z')]
    expect(retirementVerdict(base({ trades: rows, benchmark: null })).rule).not.toBe('benchmark_two_quarters')
  })
  it(`a strategy that can't reach ${MIN_CLOSED_TRADES} trades in ${RETIRE_EVIDENCE_DEADLINE_DAYS} days is switched off`, () => {
    const old = base({ trades: trades(8, 0.01), windowStart: day(NOW.toISOString(), -400) })
    expect(retirementVerdict(old)).toMatchObject({ retire: true, rule: 'no_evidence_deadline' })
    const young = base({ trades: trades(8, 0.01), windowStart: day(NOW.toISOString(), -300) })
    expect(retirementVerdict(young).retire).toBe(false)
  })
  it('a healthy strategy stays on', () => {
    const healthy = trades(40, 0.01).map((t, i) => ({ ...t, realized_pnl_pct: i % 5 === 0 ? -0.005 : 0.01, realized_pnl_usd: i % 5 === 0 ? -5 : 10 }))
    expect(retirementVerdict(base({ trades: healthy, benchmark: 'hold_no' })).retire).toBe(false)
  })
})

describe('weekly summary', () => {
  it('says plainly what was switched off', () => {
    const one = generateWeeklySummary({ closes: [], opens: [], blocked: [], halted: false, retired: ['Quant Momentum'] })
    expect(one[0]).toBe('Switched off the Quant Momentum playbook — it kept missing its targets after costs. It’s still tracked, and you can turn it back on.')
    const two = generateWeeklySummary({ closes: [], opens: [], blocked: [], halted: false, retired: ['A', 'B'] })
    expect(two[0]).toMatch(/^Switched off 2 playbooks/)
  })
})

// ─── The weekly job ──────────────────────────────────────────────────────────

type Row = Record<string, unknown>
function fakeAdmin(tables: Record<string, Row[]>) {
  const ops: Array<{ table: string; op: string; row?: Row; filters?: Array<[string, unknown]> }> = []
  const client = {
    from: (table: string) => {
      const filters: Array<[string, unknown]> = []
      let mode: 'select' | 'update' = 'select'
      let patch: Row = {}
      const c: Record<string, unknown> = {}
      c.select = () => c
      c.not = () => c
      c.order = () => c
      c.limit = () => c
      c.eq = (k: string, v: unknown) => { filters.push([k, v]); return c }
      c.update = (p: Row) => { mode = 'update'; patch = p; return c }
      c.insert = (row: Row) => {
        ops.push({ table, op: 'insert', row })
        return { then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok) }
      }
      c.upsert = async (row: Row) => { ops.push({ table, op: 'upsert', row }); return { error: null } }
      c.then = (ok: (v: unknown) => unknown) => {
        if (mode === 'update') { ops.push({ table, op: 'update', row: patch, filters }); return Promise.resolve({ error: null }).then(ok) }
        const rows = (tables[table] ?? []).filter(r => filters.every(([k, v]) => r[k] === v))
        return Promise.resolve({ data: rows, error: null }).then(ok)
      }
      return c
    },
  }
  return { admin: client as never, ops }
}
const noBench = { spy: new Map(), btc: new Map(), fx: new Map() }

describe('runRetirementReview', () => {
  const losing = trades(40, -0.002).map(t => ({ ...t, user_id: 'u1', strategy_key: 'quant_momentum', asset_class: 'stocks', status: 'closed' }))
  const prior = (n: number) => Array.from({ length: n }, (_, i) => ({
    user_id: 'u1', strategy_key: 'quant_momentum',
    week: new Date(Date.UTC(2026, 10, 16) - i * 7 * 86_400_000).toISOString().slice(0, 10), failing: true,
  }))

  it('records a snapshot per enabled strategy and switches off a persistent loser — logged and alerted', async () => {
    const { runRetirementReview } = await import('@/lib/strategies/retirement-job')
    const { admin, ops } = fakeAdmin({
      user_enabled_strategies: [
        { user_id: 'u1', strategy_key: 'quant_momentum', created_at: '2026-03-01T00:00:00Z', paper_enabled: true },
        { user_id: 'u1', strategy_key: 'pead', created_at: '2026-10-01T00:00:00Z', paper_enabled: true },
        { user_id: 'u1', strategy_key: 'merger_arb', created_at: '2025-01-01T00:00:00Z', paper_enabled: false },
      ],
      paper_positions: losing,
      strategy_gate_snapshots: prior(RETIRE_FAIL_WEEKS - 1),
      strategy_retirement_log: [],
    })
    const run = await runRetirementReview(admin, { now: NOW, benchmarks: noBench })
    expect(run.reviewed).toBe(2)                 // merger_arb isn't paper-enabled → not judged
    expect(run.retired).toEqual([{ userId: 'u1', strategyKey: 'quant_momentum', rule: 'gate_failure_streak' }])
    expect(ops.filter(o => o.table === 'strategy_gate_snapshots' && o.op === 'upsert')).toHaveLength(2)
    const off = ops.find(o => o.table === 'user_enabled_strategies' && o.op === 'update')!
    expect(off.row).toEqual({ paper_enabled: false })
    expect(off.filters).toEqual([['user_id', 'u1'], ['strategy_key', 'quant_momentum']])
    expect(ops.find(o => o.table === 'strategy_retirement_log')!.row).toMatchObject({ user_id: 'u1', rule: 'gate_failure_streak' })
    expect(ops.find(o => o.table === 'alerts')!.row).toMatchObject({
      user_id: 'u1', type: 'system', title: 'Switched off: Quant Momentum', action_url: '/strategies/readiness',
    })
    // Never more trading, never a maturity change.
    expect(ops.some(o => o.op === 'update' && o.row?.paper_enabled === true)).toBe(false)
    expect(ops.some(o => o.table === 'strategy_definitions')).toBe(false)
  })

  it('a re-enabled strategy starts fresh: trades and weeks before its last switch-off are ignored', async () => {
    const { runRetirementReview } = await import('@/lib/strategies/retirement-job')
    const { admin, ops } = fakeAdmin({
      user_enabled_strategies: [{ user_id: 'u1', strategy_key: 'quant_momentum', created_at: '2026-03-01T00:00:00Z', paper_enabled: true }],
      paper_positions: losing,                                // all closed before the switch-off below
      strategy_gate_snapshots: prior(RETIRE_FAIL_WEEKS - 1),
      strategy_retirement_log: [{ user_id: 'u1', strategy_key: 'quant_momentum', created_at: '2026-11-17T00:00:00Z' }],
    })
    const run = await runRetirementReview(admin, { now: NOW, benchmarks: noBench })
    expect(run.retired).toEqual([])
    expect(ops.find(o => o.table === 'strategy_gate_snapshots')!.row).toMatchObject({ closed_trades: 0, failing: null })
  })
})

describe('ops alerts use the alerts table’s real shape', () => {
  it('writes type system + body; falls back to the legacy shape only on error', async () => {
    const { sendOpsAlert } = await import('@/lib/ops/alert')
    const rows: Row[] = []
    const ok = { from: () => ({ insert: async (r: Row) => { rows.push(r); return { error: null } } }) } as never
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await sendOpsAlert(ok, { severity: 'warning', title: 'T', message: 'M', userId: 'u1' })
    expect(rows).toEqual([expect.objectContaining({ type: 'system', body: 'M', user_id: 'u1', metadata: { source: 'ops' } })])
    expect(rows[0]).not.toHaveProperty('message')

    const tries: Row[] = []
    const legacyOnly = { from: () => ({ insert: async (r: Row) => { tries.push(r); return { error: r.type === 'system' ? { message: 'column body does not exist' } : null } } }) } as never
    await sendOpsAlert(legacyOnly, { severity: 'critical', title: 'T', message: 'M' })
    expect(tries.map(t => t.type)).toEqual(['system', 'ops'])
  })
})

describe('contracts', () => {
  it('the lifecycle cron runs the new review', () => {
    const cron = read('lib/cron/tasks.ts')
    expect(cron).toContain('runRetirementReview(createAdminClient())')
    expect(cron).not.toContain("from('strategy_retirement_log').insert")   // moved into the job
  })
  it('the readiness page shows retirements and the luck gate flows through', () => {
    expect(read('app/(app)/strategies/readiness/page.tsx')).toContain('Retirement')
    expect(read('lib/actions/track-record.ts')).toContain('tradeReturnsPct')
    expect(read('lib/actions/promotion-readiness.ts')).toContain('tradeReturnsPct')
  })
  it('migration 20260704r: retirement log + gate snapshots, users read own, service writes', () => {
    const sql = read('supabase/migrations/20260704r_strategy_retirement.sql')
    for (const t of ['strategy_retirement_log', 'strategy_gate_snapshots']) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${t}`)
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`)
    }
    expect(sql).toContain('PRIMARY KEY (user_id, strategy_key, week)')
    expect(sql).not.toMatch(/FOR (INSERT|UPDATE|ALL) USING \(user_id = auth\.uid\(\)\)/)
  })
})
