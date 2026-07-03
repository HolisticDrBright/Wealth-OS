/**
 * Empirical Kelly sizing — the shared path that replaced strength-as-probability.
 *
 * Old behavior (proven wrong here): Kelly computed from signal `strength`
 * (a heuristic like min(1, m/0.1)), so strength=1.0 implied max size for any
 * noisy signal, and equity defaulted to $10k fiction when unfetchable.
 *
 * New behavior: win prob from rolling calibration; no history → fixed
 * maturity-floor probe; equity real or REFUSE (0 + audit log).
 */

import { describe, it, expect, vi } from 'vitest'
import {
  computeEmpiricalSize,
  applyEmpiricalHaircuts,
  winLossRatioFor,
  UNCALIBRATED_PROBE_FRACTION,
} from '@/lib/risk/empirical-sizing'
import { quarterKelly } from '@/lib/strategies/risk-controls'
import { BasePipelineStrategy } from '@/lib/strategies/BasePipelineStrategy'
import type { AssetClass, StrategyKey } from '@/lib/strategies/strategy-registry'
import type { Opportunity } from '@/lib/strategies/pipeline-types'

type Row = Record<string, unknown>

/** Chainable thenable supabase mock; per-table rows or errors. */
function makeSupabase(tables: Record<string, { data?: Row[] | null; error?: { message: string } | null }>) {
  const inserts: Record<string, Row[]> = {}
  const client = {
    _inserts: inserts,
    from: vi.fn((table: string) => {
      const res = tables[table] ?? { data: [], error: null }
      const result = { data: res.data ?? [], error: res.error ?? null }
      const builder: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) => resolve(result),
      }
      for (const m of ['select', 'eq', 'gte', 'order', 'limit']) builder[m] = () => builder
      builder.single = () => Promise.resolve({
        data: Array.isArray(result.data) ? result.data[0] ?? null : result.data,
        error: result.error,
      })
      builder.insert = (row: Row) => {
        (inserts[table] ??= []).push(row)
        return Promise.resolve({ error: null })
      }
      return builder
    }),
  }
  return client as never
}

/** n graded outcomes with the given win rate and brier score. */
function outcomeRows(n: number, winRate: number, brier: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    brier_score: brier,
    actual_direction: i < Math.round(n * winRate) ? 1 : 0,
    created_at: new Date().toISOString(),
  }))
}

const OPP: Pick<Opportunity, 'bracket' | 'symbol'> = { symbol: 'TEST' }

describe('computeEmpiricalSize — uncalibrated strategies', () => {
  it('paper_trading strategy with no history sizes at the maturity floor (2% × 0.5 = 1%)', async () => {
    const supabase = makeSupabase({ assets: { data: [{ current_value: 100_000 }] } })
    const r = await computeEmpiricalSize({ supabase, userId: 'u1', strategyKey: 'pead', opp: OPP })
    expect(r.blocked).toBe(false)
    expect(r.winProbSource).toBe('maturity_floor')
    expect(r.fraction).toBeCloseTo(UNCALIBRATED_PROBE_FRACTION * 0.5, 10)
    expect(r.notionalUsd).toBeCloseTo(100_000 * UNCALIBRATED_PROBE_FRACTION * 0.5, 6)
  })

  it('backtest_ready strategy floors 5× lower (2% × 0.1 = 0.2%)', async () => {
    const supabase = makeSupabase({ assets: { data: [{ current_value: 100_000 }] } })
    const r = await computeEmpiricalSize({
      supabase, userId: 'u1', strategyKey: 'buyback_announcement_momentum', opp: OPP,
    })
    expect(r.fraction).toBeCloseTo(UNCALIBRATED_PROBE_FRACTION * 0.1, 10)
  })

  it('stub strategies are BLOCKED — never sized, never executed', async () => {
    const supabase = makeSupabase({ assets: { data: [{ current_value: 100_000 }] } })
    const r = await computeEmpiricalSize({
      supabase, userId: 'u1', strategyKey: 'odte_strangle_hedged', opp: OPP,
    })
    expect(r.blocked).toBe(true)
    expect(r.fraction).toBe(0)
    expect(r.reason).toContain('maturity_blocked')
  })

  it('unknown strategy key refuses to size', async () => {
    const supabase = makeSupabase({ assets: { data: [{ current_value: 100_000 }] } })
    const r = await computeEmpiricalSize({
      supabase, userId: 'u1', strategyKey: 'not_a_real_strategy', opp: OPP,
    })
    expect(r.blocked).toBe(true)
    expect(r.reason).toContain('unknown_strategy_key')
  })
})

describe('computeEmpiricalSize — calibration beats strength', () => {
  it('uses the rolling win rate once ≥10 graded outcomes exist', async () => {
    const supabase = makeSupabase({
      assets: { data: [{ current_value: 100_000 }] },
      outcome_log: { data: outcomeRows(20, 0.6, 0.15) },
    })
    const r = await computeEmpiricalSize({ supabase, userId: 'u1', strategyKey: 'pead', opp: OPP })
    expect(r.winProbSource).toBe('calibration')
    expect(r.winProb).toBeCloseTo(0.6, 10)
    // quarterKelly(0.6, 1.5) × maturity(paper 0.5) × brier(1 − 0.15×2 = 0.7)
    const expected = quarterKelly(0.6, 1.5) * 0.5 * 0.7
    expect(r.fraction).toBeCloseTo(expected, 10)
  })

  it('a losing calibration (winRate 30%) zeroes the size — no override from a strong signal', async () => {
    const supabase = makeSupabase({
      assets: { data: [{ current_value: 100_000 }] },
      outcome_log: { data: outcomeRows(20, 0.3, 0.3) },
    })
    const r = await computeEmpiricalSize({ supabase, userId: 'u1', strategyKey: 'pead', opp: OPP })
    // quarterKelly(0.3, 1.5) = max(0, 0.3 − 0.7/1.5)/4 < 0 → 0
    expect(r.fraction).toBe(0)
  })

  it('never exceeds the 10% hard cap even with a stellar record', async () => {
    const supabase = makeSupabase({
      assets: { data: [{ current_value: 100_000 }] },
      outcome_log: { data: outcomeRows(20, 0.95, 0.02) },
    })
    const r = await computeEmpiricalSize({
      supabase, userId: 'u1', strategyKey: 'pead', opp: { symbol: 'T', bracket: { takeProfitPct: 0.5, stopLossPct: 0.02 } },
    })
    expect(r.fraction).toBeLessThanOrEqual(0.10)
  })
})

describe('computeEmpiricalSize — equity discipline', () => {
  it('REFUSES to size when equity cannot be fetched (query error) and audits the refusal', async () => {
    const supabase = makeSupabase({
      assets: { error: { message: 'network down' } },
    })
    const r = await computeEmpiricalSize({ supabase, userId: 'u1', strategyKey: 'pead', opp: OPP })
    expect(r.blocked).toBe(true)
    expect(r.fraction).toBe(0)
    expect(r.notionalUsd).toBe(0)
    expect(r.reason).toContain('equity_unavailable')
    const inserts = (supabase as unknown as { _inserts: Record<string, Row[]> })._inserts
    expect(inserts.audit_logs?.[0]?.decision).toBe('block')
  })

  it('REFUSES to size with zero/no assets — never a $10k default', async () => {
    const supabase = makeSupabase({ assets: { data: [] } })
    const r = await computeEmpiricalSize({ supabase, userId: 'u1', strategyKey: 'pead', opp: OPP })
    expect(r.blocked).toBe(true)
    expect(r.reason).toContain('equity_unavailable')
  })

  it('no supabase client → refuse (0)', async () => {
    const r = await computeEmpiricalSize({ supabase: undefined, userId: 'u1', strategyKey: 'pead', opp: OPP })
    expect(r.fraction).toBe(0)
    expect(r.blocked).toBe(true)
  })
})

describe('strength no longer implies size', () => {
  class TestStrategy extends BasePipelineStrategy {
    readonly key = 'pead' as StrategyKey
    readonly displayName = 'Test'
    readonly assetClass: AssetClass = 'stocks'
  }

  function makeOpp(strength: number): Opportunity {
    return {
      id: 'o1',
      strategyKey: 'pead' as StrategyKey,
      symbol: 'TEST',
      direction: 'long',
      assetClass: 'stocks',
      strength,
      expectedReturn: 0.05,
      metadata: {},
      detectedAt: new Date().toISOString(),
    }
  }

  it('runRiskCheck returns the SAME fraction for strength 0.2 and 1.0 (uncalibrated)', async () => {
    const strat = new TestStrategy()
    const supabase = makeSupabase({ assets: { data: [{ current_value: 100_000 }] } })
    const weak = await strat.runRiskCheck(makeOpp(0.2), 'u1', supabase)
    const max  = await strat.runRiskCheck(makeOpp(1.0), 'u1', supabase)
    expect(max.kellyFraction).toBe(weak.kellyFraction)
    // and it is the maturity-floor probe, nowhere near the old strength-driven max
    expect(max.kellyFraction).toBeCloseTo(UNCALIBRATED_PROBE_FRACTION * 0.5, 10)
    expect(max.kellyFraction).toBeLessThan(0.10)
  })

  it('sizePosition refuses (0 notional) when equity is unfetchable', async () => {
    const strat = new TestStrategy()
    const supabase = makeSupabase({ assets: { error: { message: 'boom' } } })
    const verdicts = {
      mirofish: null,
      kronos: null,
      redTeam: { passed: true, score: 70 },
      risk: { veto: false, kellyFraction: 0.05 },
    }
    const size = await strat.sizePosition(makeOpp(0.9), verdicts, 'u1', supabase)
    expect(size.fraction).toBe(0)
    expect(size.notionalUsd).toBe(0)
    expect(size.rationale).toContain('equity_unavailable')
  })

  it('sizePosition uses REAL equity for notional', async () => {
    const strat = new TestStrategy()
    const supabase = makeSupabase({ assets: { data: [{ current_value: 250_000 }] } })
    const verdicts = {
      mirofish: null,
      kronos: null,
      redTeam: { passed: true, score: 70 },
      risk: { veto: false, kellyFraction: 0.04 },
    }
    const size = await strat.sizePosition(makeOpp(0.9), verdicts, 'u1', supabase)
    expect(size.fraction).toBeCloseTo(0.04, 10)
    expect(size.notionalUsd).toBeCloseTo(0.04 * 250_000, 6)
  })
})

describe('applyEmpiricalHaircuts (structural strategies)', () => {
  it('haircuts a structural fraction by maturity, never raises it', async () => {
    const supabase = makeSupabase({ assets: { data: [{ current_value: 100_000 }] } })
    // lst_basis_arb is backtest_ready → 0.1×
    const r = await applyEmpiricalHaircuts(0.05, { supabase, strategyKey: 'lst_basis_arb' })
    expect(r.blocked).toBe(false)
    expect(r.fraction).toBeCloseTo(0.005, 10)
    expect(r.fraction).toBeLessThanOrEqual(0.05)
  })

  it('blocks stub strategies outright', async () => {
    const supabase = makeSupabase({})
    const r = await applyEmpiricalHaircuts(0.05, { supabase, strategyKey: 'ibit_vol_skew' })
    expect(r.blocked).toBe(true)
    expect(r.fraction).toBe(0)
  })
})

describe('winLossRatioFor', () => {
  it('derives payoff ratio from the bracket, clamped to [0.5, 5]', () => {
    expect(winLossRatioFor({ bracket: { takeProfitPct: 0.06, stopLossPct: 0.02 } })).toBeCloseTo(3, 10)
    expect(winLossRatioFor({ bracket: { takeProfitPct: 0.9, stopLossPct: 0.01 } })).toBe(5)
    expect(winLossRatioFor({ bracket: { takeProfitPct: 0.01, stopLossPct: 0.10 } })).toBe(0.5)
    expect(winLossRatioFor({})).toBe(1.5)
  })
})
