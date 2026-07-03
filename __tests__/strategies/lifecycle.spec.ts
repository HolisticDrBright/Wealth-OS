/**
 * Auto-retirement funnel (R6): synthetic decay demotes at the right quarter;
 * healthy strategies untouched; no LLM discretion — pure thresholds.
 */

import { describe, it, expect } from 'vitest'
import { evaluateLifecycle, quarterOf, isCompleteQuarter } from '@/lib/strategies/lifecycle'

const q = (quarter: string, strat: number, bench: number, trades = 10) =>
  ({ quarter, strategyReturnPct: strat, benchmarkReturnPct: bench, trades })

describe('evaluateLifecycle', () => {
  it('synthetic decay: two consecutive trailing quarters → demote exactly then', () => {
    // Healthy, healthy, fail — one failing quarter: no demotion yet.
    const after1 = evaluateLifecycle('pead', [q('2025-Q3', 4, 2), q('2025-Q4', 3, 2), q('2026-Q1', 0, 3)])
    expect(after1.demote).toBe(false)
    // Second consecutive failure lands → demote.
    const after2 = evaluateLifecycle('pead', [
      q('2025-Q3', 4, 2), q('2025-Q4', 3, 2), q('2026-Q1', 0, 3), q('2026-Q2', -1, 2),
    ])
    expect(after2.demote).toBe(true)
    expect(after2.report).toContain('demoted')
    expect(after2.report).toContain('2026-Q1')
    expect(after2.report).toContain('2026-Q2')
  })

  it('healthy strategy untouched; recovery between failures resets the streak', () => {
    expect(evaluateLifecycle('vcp', [q('2026-Q1', 5, 2), q('2026-Q2', 4, 3)]).demote).toBe(false)
    // fail, recover, fail — not consecutive
    expect(evaluateLifecycle('vcp', [q('2025-Q4', 0, 2), q('2026-Q1', 5, 2), q('2026-Q2', 0, 2)]).demote).toBe(false)
  })

  it('thin quarters (< 5 trades) are not evaluable — no demotion on noise', () => {
    const v = evaluateLifecycle('pead', [q('2026-Q1', -5, 2, 3), q('2026-Q2', -5, 2, 2)])
    expect(v.demote).toBe(false)
  })

  it('quarter helpers', () => {
    expect(quarterOf('2026-02-10T00:00:00Z')).toBe('2026-Q1')
    expect(quarterOf('2026-07-03T00:00:00Z')).toBe('2026-Q3')
    expect(isCompleteQuarter('2026-Q1', new Date('2026-07-03'))).toBe(true)
    expect(isCompleteQuarter('2026-Q3', new Date('2026-07-03'))).toBe(false)
  })
})
