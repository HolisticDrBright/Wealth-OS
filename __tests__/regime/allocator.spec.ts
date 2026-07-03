/**
 * Regime allocator (R4): classifier on historical fixture inputs,
 * regime-conditional weights, crisis playbook dry-run.
 */

import { describe, it, expect } from 'vitest'
import {
  classifyAllocatorRegime, regimeConditionalWeights, MIN_REGIME_OUTCOMES,
  type RegimeOutcome,
} from '@/lib/regime/allocator'
import { CRISIS_PLAYBOOKS, executePlaybook } from '@/lib/regime/playbooks'

describe('classifyAllocatorRegime — historical fixtures', () => {
  it('2020-03 (liquidity crash): OAS ~870bps, vol ~4× median → crisis', () => {
    expect(classifyAllocatorRegime({
      curve2s10s: 0.45, hyOasBps: 870, realizedVolRatio: 4.0, breadth: 0.05,
    })).toBe('crisis')
  })
  it('2022-06 (rates shock): inverted curve, OAS ~580, vol 1.7× → risk_off', () => {
    expect(classifyAllocatorRegime({
      curve2s10s: -0.30, hyOasBps: 580, realizedVolRatio: 1.7, breadth: 0.25,
    })).toBe('risk_off')
  })
  it('2024-11 (post-election rally): steep-ish curve, tight spreads → risk_on', () => {
    expect(classifyAllocatorRegime({
      curve2s10s: 0.6, hyOasBps: 280, realizedVolRatio: 0.9, breadth: 0.75,
    })).toBe('risk_on')
  })
  it('mixed evidence → transition', () => {
    expect(classifyAllocatorRegime({
      curve2s10s: -0.3, hyOasBps: 350, realizedVolRatio: 1.0, breadth: 0.7,
    })).toBe('transition')
  })
})

describe('regimeConditionalWeights', () => {
  const globalW = { a: 0.4, b: 0.4, c: 0.2 }
  const outcomes: RegimeOutcome[] = [
    // 'a' great in risk_off, 'b' poor — each with ≥15 outcomes
    ...Array.from({ length: MIN_REGIME_OUTCOMES }, () => ({ strategyKey: 'a', regime: 'risk_off' as const, returnPct: 0.02 })),
    ...Array.from({ length: MIN_REGIME_OUTCOMES }, () => ({ strategyKey: 'b', regime: 'risk_off' as const, returnPct: -0.01 })),
  ]

  it('softmax shifts capital toward regime winners, haircut applied, never levers up', () => {
    const w = regimeConditionalWeights(globalW, outcomes, 'risk_off')
    expect(w.a).toBeGreaterThan(w.b)
    // c has no evidence → global × haircut
    expect(w.c).toBeCloseTo(0.2 * 0.5, 6)
    const total = Object.values(w).reduce((s, v) => s + v, 0)
    expect(total).toBeLessThanOrEqual(0.5 + 1e-9)   // risk_off haircut budget
  })

  it('insufficient evidence → global weights × haircut only', () => {
    const w = regimeConditionalWeights(globalW, [], 'risk_off')
    expect(w).toEqual({ a: 0.2, b: 0.2, c: 0.1 })
  })

  it('crisis zeroes every strategy weight (pipeline hedge gate handles tail hedges)', () => {
    const w = regimeConditionalWeights(globalW, outcomes, 'crisis')
    expect(Object.values(w).every(v => v === 0)).toBe(true)
  })
})

describe('crisis playbooks', () => {
  it('all four scenarios dry-run cleanly — pre-committed, never LLM-composed', async () => {
    for (const pb of CRISIS_PLAYBOOKS) {
      const run = await executePlaybook(pb, { dryRun: true })
      expect(run.steps).toHaveLength(pb.actions.length)
      expect(run.steps.every(s => s.result.includes('dry-run'))).toBe(true)
    }
  })
  it('2020 playbook halts everything, cancels orders, tightens floors to 0.95', () => {
    const pb = CRISIS_PLAYBOOKS.find(p => p.id === 'liquidity_crash_2020')!
    expect(pb.actions).toEqual([
      { type: 'halt_sleeves', sleeves: 'all', reason: expect.stringContaining('liquidity crash') },
      { type: 'cancel_resting_orders' },
      { type: 'tighten_floors', k: 0.95 },
    ])
  })
})
