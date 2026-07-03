/**
 * Planning Monte Carlo known-answer tests (Gap brief C2).
 */

import { describe, it, expect } from 'vitest'
import {
  runPlanningMonteCarlo, planningRecommendationDelta, annuityMonthlyWithdrawal,
  type PlanningInput,
} from '@/lib/planning/monte-carlo'

const FLAT_MONTHLY = 0.004  // ~4.9%/yr, zero volatility

function base(overrides: Partial<PlanningInput> = {}): PlanningInput {
  return {
    currentAge: 40, retireAge: 60, horizonAge: 85,
    marketBucketUsd: 500_000, sleeveUsd: 0,
    annualSavingsUsd: 30_000, incomeStability: 'stable_w2',
    annualRetirementSpendUsd: 60_000,
    marketMonthlyReturns: new Array(120).fill(FLAT_MONTHLY),
    taxDragRate: 0,
    paths: 2_000, seed: 11,
    ...overrides,
  }
}

describe('known answers', () => {
  it('annuity formula matches the KB §7 ABW closed form to 4 decimals', () => {
    // $1M, 0.4%/mo, 300 months → W = V·r/(1−(1+r)^−n)
    const w = annuityMonthlyWithdrawal(1_000_000, 0.004, 300)
    const expected = 1_000_000 * 0.004 / (1 - Math.pow(1.004, -300))
    expect(w).toBeCloseTo(expected, 4)
    expect(annuityMonthlyWithdrawal(1_000_000, 0, 300)).toBeCloseTo(1_000_000 / 300, 4)
  })

  it('zero-volatility asset + withdrawal below the annuity level → P(goal) = 100%', () => {
    // Sustainable spend on the retirement pot must exceed the plan's spend.
    const r = runPlanningMonteCarlo(base({ annualRetirementSpendUsd: 48_000 }))
    expect(r.goalProbabilityPct).toBe(100)
  })

  it('zero-volatility asset + withdrawal far above the annuity level → P(goal) = 0%', () => {
    const r = runPlanningMonteCarlo(base({
      marketBucketUsd: 100_000, annualSavingsUsd: 0, annualRetirementSpendUsd: 200_000,
    }))
    expect(r.goalProbabilityPct).toBe(0)
  })

  it('deterministic under a seed', () => {
    const input = base({ marketMonthlyReturns: [0.01, -0.02, 0.03, 0.004, -0.01, 0.02, 0.015, -0.005, 0.01, 0.02, -0.03, 0.01], paths: 1_000 })
    expect(runPlanningMonteCarlo(input)).toEqual(runPlanningMonteCarlo(input))
  })
})

describe('conservatism + monotonicity', () => {
  it('sleeve prior with no trade history has ~zero mean (no free alpha)', () => {
    // Pure decumulation, no savings: all wealth in the mean-0 fat-tailed
    // sleeve must fund retirement LESS reliably than the same wealth in the
    // flat-growth market bucket — the prior grants no edge.
    const decum = { currentAge: 60, retireAge: 60, annualSavingsUsd: 0, annualRetirementSpendUsd: 30_000, paths: 3_000 }
    const withSleeve = runPlanningMonteCarlo(base({ ...decum, marketBucketUsd: 0, sleeveUsd: 500_000 }))
    const withMarket = runPlanningMonteCarlo(base({ ...decum, marketBucketUsd: 500_000, sleeveUsd: 0 }))
    expect(withMarket.goalProbabilityPct).toBe(100)
    expect(withSleeve.goalProbabilityPct).toBeLessThan(withMarket.goalProbabilityPct)
  })

  it('increasing the savings rate monotonically increases P(goal)', () => {
    const returns = [0.012, -0.018, 0.02, 0.004, -0.01, 0.02, 0.01, -0.008, 0.015, 0.018, -0.025, 0.009]
    const lo = runPlanningMonteCarlo(base({ marketMonthlyReturns: returns, marketBucketUsd: 150_000, annualSavingsUsd: 10_000, annualRetirementSpendUsd: 70_000, paths: 3_000 }))
    const mid = runPlanningMonteCarlo(base({ marketMonthlyReturns: returns, marketBucketUsd: 150_000, annualSavingsUsd: 30_000, annualRetirementSpendUsd: 70_000, paths: 3_000 }))
    const hi = runPlanningMonteCarlo(base({ marketMonthlyReturns: returns, marketBucketUsd: 150_000, annualSavingsUsd: 60_000, annualRetirementSpendUsd: 70_000, paths: 3_000 }))
    expect(mid.goalProbabilityPct).toBeGreaterThanOrEqual(lo.goalProbabilityPct)
    expect(hi.goalProbabilityPct).toBeGreaterThanOrEqual(mid.goalProbabilityPct)
  })

  it('recommendation delta is non-negative and consistent', () => {
    const input = base({
      marketMonthlyReturns: [0.012, -0.018, 0.02, 0.004, -0.01, 0.02, 0.01, -0.008, 0.015, 0.018, -0.025, 0.009],
      marketBucketUsd: 200_000, annualSavingsUsd: 25_000, annualRetirementSpendUsd: 65_000, paths: 2_000,
    })
    const d = planningRecommendationDelta(input, 9_000)  // e.g. the S-Corp saving
    expect(d.withPct).toBeGreaterThanOrEqual(d.basePct)
    expect(d.deltaPct).toBeCloseTo(d.withPct - d.basePct, 5)
  })

  it('runs 10k paths well under the 5s budget', () => {
    const t0 = Date.now()
    runPlanningMonteCarlo(base({ paths: 10_000 }))
    expect(Date.now() - t0).toBeLessThan(5_000)
  })
})
