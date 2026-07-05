/**
 * P3 — Income-Growth pillar.
 *  - trigger logic both directions
 *  - income-vs-allocation comparison uses REAL Monte Carlo deltas (fixture)
 *  - speculative income numbers provably absent from planning inputs
 *  - coaching idea cards carry the classification structure + grade
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  incomeGrowthTriggered,
  compareIncomeVsAllocation,
  generateIncomeIdeas,
  r9IncomeGrowth,
} from '@/lib/advisory/rules/r9-income-growth'
import { gradeOf } from '@/lib/advisory/engine'
import type { PlanningInput } from '@/lib/planning/monte-carlo'
import type { FinancialProfile, TaxConstants, KbParameters } from '@/lib/advisory/types'

// Deterministic 20y of monthly returns (~0.6%/mo, mild vol) for the MC fixture.
function fixtureReturns(): number[] {
  const out: number[] = []
  for (let i = 0; i < 240; i++) out.push(0.006 + 0.04 * Math.sin(i * 1.7))
  return out
}

function fixtureInput(over: Partial<PlanningInput> = {}): PlanningInput {
  // Mid-range so both levers move goal probability measurably (not saturated).
  return {
    currentAge: 45, retireAge: 65, horizonAge: 90,
    marketBucketUsd: 270_000, sleeveUsd: 30_000,
    annualSavingsUsd: 24_000, incomeStability: 'stable_w2',
    annualRetirementSpendUsd: 50_000,
    marketMonthlyReturns: fixtureReturns(),
    taxDragRate: 0.005, paths: 2_000, seed: 42,
    ...over,
  }
}

describe('incomeGrowthTriggered — both directions', () => {
  const params = { massAffluentThresholdUsd: 100_000, minSavingsRate: 0.15 }

  it('fires when investable is below the mass-affluent threshold', () => {
    const t = incomeGrowthTriggered({
      investableUsd: 40_000, annualIncomeUsd: 80_000, annualSavingsUsd: 16_000,
      waterfallUnfilled: false, ...params,
    })
    expect(t.triggered).toBe(true)
    expect(t.reason).toContain('mass-affluent threshold')
  })

  it('fires on a low savings rate with unfilled waterfall', () => {
    const t = incomeGrowthTriggered({
      investableUsd: 500_000, annualIncomeUsd: 100_000, annualSavingsUsd: 8_000,   // 8%
      waterfallUnfilled: true, ...params,
    })
    expect(t.triggered).toBe(true)
    expect(t.reason).toContain('Savings rate')
  })

  it('does NOT fire when investable is high and savings healthy', () => {
    const t = incomeGrowthTriggered({
      investableUsd: 800_000, annualIncomeUsd: 100_000, annualSavingsUsd: 25_000,  // 25%
      waterfallUnfilled: true, ...params,
    })
    expect(t.triggered).toBe(false)
  })

  it('does NOT fire on low savings rate when the waterfall is already filled', () => {
    const t = incomeGrowthTriggered({
      investableUsd: 500_000, annualIncomeUsd: 100_000, annualSavingsUsd: 8_000,
      waterfallUnfilled: false, ...params,
    })
    expect(t.triggered).toBe(false)
  })
})

describe('compareIncomeVsAllocation — real Monte Carlo deltas', () => {
  // The MC is same-seeded for base and scenario, so it is MONOTONIC: routing
  // more dollars to savings never lowers goal probability. That makes the
  // direction deterministic without depending on absolute saturation.

  it('when income routes MORE to savings than the allocation benefit, its delta ≥ allocation delta', () => {
    // income-to-savings = 2000×12×0.5 = 12,000 ≫ 200
    const c = compareIncomeVsAllocation(fixtureInput(), 2_000, 0.5, 200)
    expect(c.incomeDeltaPct).toBeGreaterThanOrEqual(c.allocationDeltaPct)
    // incomeWins is exactly the strict comparison — a tie goes to allocation.
    expect(c.incomeWins).toBe(c.incomeDeltaPct > c.allocationDeltaPct)
  })

  it('when the allocation benefit is larger, allocation delta ≥ income delta and income does not win', () => {
    // income-to-savings = 50×12×0.1 = 60 ≪ 40,000
    const c = compareIncomeVsAllocation(fixtureInput(), 50, 0.1, 40_000)
    expect(c.allocationDeltaPct).toBeGreaterThanOrEqual(c.incomeDeltaPct)
    expect(c.incomeWins).toBe(false)
    expect(c.headline).toContain('allocation change still leads')
  })

  it('incomeWins is always the definitional strict comparison, and headline matches', () => {
    for (const [inc, rate, alloc] of [[500, 0.2, 5_000], [3_000, 0.6, 0], [100, 0.1, 20_000]] as const) {
      const c = compareIncomeVsAllocation(fixtureInput(), inc, rate, alloc)
      expect(c.incomeWins).toBe(c.incomeDeltaPct > c.allocationDeltaPct)
      expect(c.headline).toContain(c.incomeWins ? 'raises your goal probability' : 'allocation change still leads')
    }
  })

  it('is pure — identical inputs give identical results (no hidden state)', () => {
    const a = compareIncomeVsAllocation(fixtureInput(), 500, 0.2, 5_000)
    const b = compareIncomeVsAllocation(fixtureInput(), 500, 0.2, 5_000)
    expect(a).toEqual(b)
  })
})

describe('speculative income never enters planning inputs', () => {
  it('planning.ts filters coaching grade before the Monte Carlo', () => {
    const src = readFileSync(join(process.cwd(), 'lib', 'actions', 'planning.ts'), 'utf8')
    expect(src).toMatch(/grade.*!==.*['"]coaching['"]/)
  })

  it('the r9 income rule is coaching-grade with null benefit (cannot feed MC deltas)', () => {
    const profile = { w2_wages_usd: 60_000, net_business_profit_usd: null, income_context: null } as unknown as FinancialProfile
    const v = r9IncomeGrowth.evaluate(profile, {} as TaxConstants, { income_pillar_income_ceiling: 100_000 } as KbParameters)
    if (v.kind !== 'recommendation') throw new Error('expected recommendation')
    expect(gradeOf(v)).toBe('coaching')
    expect(v.estimatedAnnualBenefitUsd).toBeNull()
  })

  it('the comparison helper never imports DB/profile code (pure)', () => {
    const src = readFileSync(join(process.cwd(), 'lib', 'advisory', 'rules', 'r9-income-growth.ts'), 'utf8')
    expect(src).not.toMatch(/supabase|createClient|upsertFinancialProfile/)
  })
})

describe('r9 rule + income ideas', () => {
  const params = { income_pillar_income_ceiling: 100_000 } as KbParameters

  it('below the income ceiling → coaching card with classified ideas', () => {
    const profile = { w2_wages_usd: 55_000, net_business_profit_usd: null, income_context: null } as unknown as FinancialProfile
    const v = r9IncomeGrowth.evaluate(profile, {} as TaxConstants, params)
    if (v.kind !== 'recommendation') throw new Error('expected recommendation')
    expect(v.actionSteps.join(' ')).toContain('scalable')     // digital asset classification
    expect(v.actionSteps.join(' ')).toContain('ease:')
  })

  it('above the income ceiling → not applicable (allocation still leads)', () => {
    const profile = { w2_wages_usd: 250_000, net_business_profit_usd: null } as unknown as FinancialProfile
    expect(r9IncomeGrowth.evaluate(profile, {} as TaxConstants, params).kind).toBe('not_applicable')
  })

  it('no income at all → asks for income', () => {
    const profile = { w2_wages_usd: null, net_business_profit_usd: null } as unknown as FinancialProfile
    const v = r9IncomeGrowth.evaluate(profile, {} as TaxConstants, params)
    expect(v.kind).toBe('not_applicable')
    if (v.kind === 'not_applicable') expect(v.missingFields).toContain('w2_wages_usd')
  })

  it('ideas cover all four categories with the full classification', () => {
    const ideas = generateIncomeIdeas({ income_context: { occupation: 'designer', skills: ['ui', 'branding'] } } as unknown as FinancialProfile)
    expect(ideas.map(i => i.category).sort()).toEqual(
      ['digital_asset', 'extra_income_source', 'rate_raise', 'skills_to_income'])
    for (const i of ideas) {
      expect(i.ease).toBeDefined(); expect(i.speed).toBeDefined()
      expect(i.requiredInvestment).toBeDefined(); expect(i.profitPotential).toBeDefined()
      expect(i.scalability).toBeDefined()
    }
  })
})
