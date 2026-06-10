import { describe, it, expect } from 'vitest'
import {
  runMonteCarloRetirement,
  mulberry32,
  deriveReturnStdevPct,
  type MonteCarloPlanInput,
} from '@/lib/retirement/monte-carlo'

const basePlan: MonteCarloPlanInput = {
  current_age: 40,
  target_retirement_age: 65,
  current_savings_usd: 250_000,
  annual_contribution_usd: 20_000,
  expected_return_pct: 7,
  target_monthly_income_usd: 6_000,
  social_security_monthly_usd: 2_000,
  pension_monthly_usd: 0,
}

describe('mulberry32', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(123)
    const b = mulberry32(123)
    for (let i = 0; i < 10; i++) expect(a()).toBe(b())
  })

  it('produces values in [0, 1)', () => {
    const rng = mulberry32(7)
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('differs across seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })
})

describe('deriveReturnStdevPct', () => {
  it('defaults equity-heavy portfolios to 12%', () => {
    expect(deriveReturnStdevPct(7)).toBe(12)
    expect(deriveReturnStdevPct(9)).toBe(12)
  })

  it('lowers stdev for conservative mixes', () => {
    expect(deriveReturnStdevPct(4.5)).toBeLessThan(deriveReturnStdevPct(7))
    expect(deriveReturnStdevPct(2)).toBeLessThan(deriveReturnStdevPct(4.5))
  })
})

describe('runMonteCarloRetirement', () => {
  it('produces stable results for a deterministic seed', () => {
    const a = runMonteCarloRetirement(basePlan, { paths: 500, seed: 42 })
    const b = runMonteCarloRetirement(basePlan, { paths: 500, seed: 42 })
    expect(a.successProbability).toBe(b.successProbability)
    expect(a.medianDepletionAge).toBe(b.medianDepletionAge)
    expect(a.bands).toEqual(b.bands)
  })

  it('changes results for a different seed (sanity check on randomness)', () => {
    const a = runMonteCarloRetirement(basePlan, { paths: 500, seed: 42 })
    const b = runMonteCarloRetirement(basePlan, { paths: 500, seed: 43 })
    expect(a.bands[10].p50).not.toBe(b.bands[10].p50)
  })

  it('gives higher success probability for higher contributions', () => {
    const low = runMonteCarloRetirement(
      { ...basePlan, annual_contribution_usd: 2_000 },
      { paths: 1000, seed: 42 }
    )
    const high = runMonteCarloRetirement(
      { ...basePlan, annual_contribution_usd: 40_000 },
      { paths: 1000, seed: 42 }
    )
    expect(high.successProbability).toBeGreaterThan(low.successProbability)
  })

  it('is near-zero success with no savings and a high income target', () => {
    const result = runMonteCarloRetirement(
      {
        ...basePlan,
        current_savings_usd: 0,
        annual_contribution_usd: 0,
        target_monthly_income_usd: 15_000,
        social_security_monthly_usd: 0,
      },
      { paths: 1000, seed: 42 }
    )
    expect(result.successProbability).toBeLessThan(0.02)
    expect(result.medianDepletionAge).not.toBeNull()
    // Depletion happens essentially immediately after retiring.
    expect(result.medianDepletionAge!).toBeLessThanOrEqual(67)
  })

  it('builds percentile bands per year through endAge with ordered percentiles', () => {
    const result = runMonteCarloRetirement(basePlan, { paths: 300, seed: 1 })
    // current_age 40 → 95 = 55 years + year 0
    expect(result.bands).toHaveLength(56)
    expect(result.bands[0].age).toBe(40)
    expect(result.bands.at(-1)!.age).toBe(95)
    for (const band of result.bands) {
      expect(band.p10).toBeLessThanOrEqual(band.p25)
      expect(band.p25).toBeLessThanOrEqual(band.p50)
      expect(band.p50).toBeLessThanOrEqual(band.p75)
      expect(band.p75).toBeLessThanOrEqual(band.p90)
    }
    // Phase flips after retirement age
    const atRetirement = result.bands.find(b => b.age === 65)!
    const afterRetirement = result.bands.find(b => b.age === 66)!
    expect(atRetirement.phase).toBe('accumulation')
    expect(afterRetirement.phase).toBe('retirement')
  })

  it('reports null depletion age when every path succeeds', () => {
    const result = runMonteCarloRetirement(
      {
        ...basePlan,
        current_savings_usd: 50_000_000,
        target_monthly_income_usd: 3_000,
      },
      { paths: 200, seed: 5 }
    )
    expect(result.successProbability).toBe(1)
    expect(result.medianDepletionAge).toBeNull()
  })

  it('respects an explicit returnStdevPct parameter', () => {
    const result = runMonteCarloRetirement(basePlan, {
      paths: 100,
      seed: 9,
      returnStdevPct: 5,
    })
    expect(result.returnStdevPct).toBe(5)
  })
})
