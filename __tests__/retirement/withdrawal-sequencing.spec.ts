import { describe, it, expect } from 'vitest'
import {
  planWithdrawals,
  computeRmd,
  UNIFORM_LIFETIME_TABLE,
  RMD_START_AGE,
} from '@/lib/retirement/withdrawal-sequencing'

const baseInput = {
  taxableBalance: 100_000,
  traditionalBalance: 300_000,
  rothBalance: 200_000,
  annualNeed: 50_000,
  age: 65,
  marginalRate: 0.24,
  ltcgRate: 0.15,
}

describe('computeRmd', () => {
  it('is zero before age 73', () => {
    expect(computeRmd(72, 500_000)).toBe(0)
    expect(computeRmd(65, 500_000)).toBe(0)
  })

  it('uses the Uniform Lifetime factor at 73+', () => {
    expect(computeRmd(73, 265_000)).toBeCloseTo(265_000 / 26.5, 6)
    expect(computeRmd(80, 202_000)).toBeCloseTo(202_000 / 20.2, 6)
  })

  it('is zero with no traditional balance', () => {
    expect(computeRmd(75, 0)).toBe(0)
  })

  it('has table coverage from 73 onward', () => {
    expect(RMD_START_AGE).toBe(73)
    expect(UNIFORM_LIFETIME_TABLE[73]).toBe(26.5)
    expect(UNIFORM_LIFETIME_TABLE[95]).toBe(8.9)
  })
})

describe('planWithdrawals ordering', () => {
  it('drains taxable first, then traditional, then Roth', () => {
    const plan = planWithdrawals(baseInput)

    // Year 1-2: taxable covers the full need, nothing else touched.
    expect(plan.years[0].fromTaxable).toBe(50_000)
    expect(plan.years[0].fromTraditional).toBe(0)
    expect(plan.years[0].fromRoth).toBe(0)
    expect(plan.years[1].fromTaxable).toBe(50_000)
    expect(plan.years[1].endingTaxable).toBe(0)

    // Year 3+: traditional kicks in only after taxable is empty.
    expect(plan.years[2].fromTaxable).toBe(0)
    expect(plan.years[2].fromTraditional).toBe(50_000)
    expect(plan.years[2].fromRoth).toBe(0)

    // Roth is only touched after traditional is exhausted.
    const firstRothYear = plan.years.find(y => y.fromRoth > 0)!
    expect(firstRothYear.endingTraditional).toBe(0)
    const lastTraditionalYear = plan.years.filter(y => y.fromTraditional > 0).at(-1)!
    expect(lastTraditionalYear.year).toBeLessThanOrEqual(firstRothYear.year)
  })

  it('never touches Roth while other sources can cover the need', () => {
    const plan = planWithdrawals(baseInput)
    for (const y of plan.years) {
      if (y.fromRoth > 0) {
        expect(y.endingTaxable).toBe(0)
        expect(y.endingTraditional).toBe(0)
      }
    }
  })

  it('estimates tax at LTCG rates for taxable and ordinary rates for traditional', () => {
    const plan = planWithdrawals(baseInput)
    expect(plan.years[0].estimatedTax).toBeCloseTo(50_000 * 0.15, 6)
    expect(plan.years[2].estimatedTax).toBeCloseTo(50_000 * 0.24, 6)
    const rothOnly = plan.years.find(y => y.fromRoth > 0 && y.fromTaxable === 0 && y.fromTraditional === 0)!
    expect(rothOnly.estimatedTax).toBe(0)
  })
})

describe('planWithdrawals RMD forcing', () => {
  it('forces an RMD from traditional at 73+ even when taxable could cover the need', () => {
    const plan = planWithdrawals({ ...baseInput, age: 75 })
    const y1 = plan.years[0]
    const expectedRmd = 300_000 / UNIFORM_LIFETIME_TABLE[75]
    expect(y1.rmdForced).toBeCloseTo(expectedRmd, 6)
    expect(y1.fromTraditional).toBeCloseTo(expectedRmd, 6)
    // Taxable only fills the gap left after the RMD.
    expect(y1.fromTaxable).toBeCloseTo(50_000 - expectedRmd, 6)
  })

  it('takes the RMD even when the year’s need is already met', () => {
    const plan = planWithdrawals({
      ...baseInput,
      age: 75,
      annualNeed: 0,
    })
    const expectedRmd = 300_000 / UNIFORM_LIFETIME_TABLE[75]
    expect(plan.years[0].fromTraditional).toBeCloseTo(expectedRmd, 6)
    expect(plan.years[0].fromTaxable).toBe(0)
    expect(plan.years[0].fromRoth).toBe(0)
  })

  it('does not force RMDs before 73', () => {
    const plan = planWithdrawals({ ...baseInput, age: 70 })
    expect(plan.years[0].rmdForced).toBe(0)
    expect(plan.years[0].fromTraditional).toBe(0)
  })
})

describe('planWithdrawals depletion', () => {
  it('reports a shortfall and depletion age when all sources run dry', () => {
    const plan = planWithdrawals({
      taxableBalance: 40_000,
      traditionalBalance: 40_000,
      rothBalance: 20_000,
      annualNeed: 50_000,
      age: 65,
      marginalRate: 0.22,
      ltcgRate: 0.15,
    })
    expect(plan.depletionAge).not.toBeNull()
    const lastYear = plan.years.at(-1)!
    expect(lastYear.shortfall).toBeGreaterThan(0)
    expect(lastYear.endingTaxable).toBe(0)
    expect(lastYear.endingTraditional).toBe(0)
    expect(lastYear.endingRoth).toBe(0)
  })

  it('accumulates total estimated tax across years', () => {
    const plan = planWithdrawals(baseInput)
    const summed = plan.years.reduce((s, y) => s + y.estimatedTax, 0)
    expect(plan.totalEstimatedTax).toBeCloseTo(summed, 6)
  })
})
