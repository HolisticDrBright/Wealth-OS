import { describe, it, expect } from 'vitest'
import {
  buildWaterfall,
  LIMIT_401K_EMPLOYEE_2026,
  LIMIT_401K_CATCHUP_50_2026,
  LIMIT_IRA_2026,
  LIMIT_IRA_CATCHUP_50_2026,
  LIMIT_HSA_SELF_2026,
  LIMIT_HSA_FAMILY_2026,
  LIMIT_HSA_CATCHUP_55_2026,
} from '@/lib/savings/contribution-waterfall'

const baseInput = {
  age: 35,
  income: 150_000,
  employerMatchPct: 50,
  matchLimitPct: 6,
  currentContributions: { k401: 5_000, hsa: 1_000, rothIra: 0, taxable: 2_000 },
}

describe('buildWaterfall ordering', () => {
  it('orders steps: match → HSA → Roth IRA → 401k max → taxable', () => {
    const result = buildWaterfall(baseInput)
    expect(result.steps.map(s => s.id)).toEqual([
      'k401_match',
      'hsa_max',
      'roth_ira_max',
      'k401_max',
      'taxable',
    ])
    expect(result.steps.map(s => s.order)).toEqual([1, 2, 3, 4, 5])
  })

  it('puts the employer match first with target = matchLimitPct of salary', () => {
    const result = buildWaterfall(baseInput)
    const match = result.steps[0]
    expect(match.target).toBe(150_000 * 0.06) // 9,000
    expect(match.current).toBe(5_000)
    expect(match.gap).toBe(4_000)
    expect(match.complete).toBe(false)
    expect(match.why).toMatch(/match/i)
  })

  it('counts 401k contributions toward both match and max steps', () => {
    const result = buildWaterfall({
      ...baseInput,
      currentContributions: { ...baseInput.currentContributions, k401: 12_000 },
    })
    const match = result.steps[0]
    const max = result.steps[3]
    expect(match.current).toBe(9_000) // capped at match target
    expect(match.complete).toBe(true)
    expect(max.current).toBe(12_000)
    expect(max.gap).toBe(LIMIT_401K_EMPLOYEE_2026 - 12_000)
  })

  it('marks taxable as open-ended with no gap', () => {
    const taxable = buildWaterfall(baseInput).steps[4]
    expect(taxable.gap).toBe(0)
    expect(taxable.complete).toBe(true)
    expect(taxable.why).toMatch(/no contribution limit/i)
  })
})

describe('buildWaterfall limits under age 50', () => {
  it('uses base 2026 limits', () => {
    const result = buildWaterfall(baseInput)
    expect(result.limits.k401).toBe(LIMIT_401K_EMPLOYEE_2026)
    expect(result.limits.ira).toBe(LIMIT_IRA_2026)
    expect(result.limits.hsa).toBe(LIMIT_HSA_SELF_2026)
  })

  it('uses the family HSA limit when coverage is family', () => {
    const result = buildWaterfall({ ...baseInput, hsaCoverage: 'family' as const })
    expect(result.limits.hsa).toBe(LIMIT_HSA_FAMILY_2026)
  })
})

describe('buildWaterfall catch-up contributions', () => {
  it('includes 50+ catch-up in 401k and IRA limits', () => {
    const result = buildWaterfall({ ...baseInput, age: 52 })
    expect(result.limits.k401).toBe(LIMIT_401K_EMPLOYEE_2026 + LIMIT_401K_CATCHUP_50_2026)
    expect(result.limits.ira).toBe(LIMIT_IRA_2026 + LIMIT_IRA_CATCHUP_50_2026)
    // HSA catch-up starts at 55, not 50.
    expect(result.limits.hsa).toBe(LIMIT_HSA_SELF_2026)
    expect(result.steps[2].why).toMatch(/catch-up/i)
    expect(result.steps[3].why).toMatch(/catch-up/i)
  })

  it('includes the HSA catch-up at 55+', () => {
    const result = buildWaterfall({ ...baseInput, age: 56 })
    expect(result.limits.hsa).toBe(LIMIT_HSA_SELF_2026 + LIMIT_HSA_CATCHUP_55_2026)
    expect(result.steps[1].why).toMatch(/catch-up/i)
  })

  it('widens gaps accordingly for a 50+ saver', () => {
    const young = buildWaterfall(baseInput)
    const older = buildWaterfall({ ...baseInput, age: 55 })
    const youngMax = young.steps.find(s => s.id === 'k401_max')!
    const olderMax = older.steps.find(s => s.id === 'k401_max')!
    expect(olderMax.gap - youngMax.gap).toBe(LIMIT_401K_CATCHUP_50_2026)
  })
})

describe('buildWaterfall totals', () => {
  it('sums targets/current/gap across capped steps only', () => {
    const result = buildWaterfall(baseInput)
    const capped = result.steps.filter(s => s.id !== 'taxable')
    expect(result.totalTarget).toBeCloseTo(capped.reduce((s, x) => s + x.target, 0), 2)
    expect(result.totalCurrent).toBeCloseTo(capped.reduce((s, x) => s + x.current, 0), 2)
    expect(result.totalGap).toBeCloseTo(capped.reduce((s, x) => s + x.gap, 0), 2)
  })
})
