/**
 * Items 10–11 — best-next-dollar ranking (rules-based, explainable, never
 * moves money) and the data-quality labels that prevent overclaiming.
 */

import { describe, it, expect } from 'vitest'
import { rankNextDollar, type NextDollarInputs } from '@/lib/advisory/next-dollar'
import { buildQualityLabel, splitInputs } from '@/lib/advisory/data-quality'

function inputs(overrides: Partial<NextDollarInputs> = {}): NextDollarInputs {
  return {
    emergencyFundUsd: 20_000,
    emergencyTargetUsd: 18_000,
    employerMatchAvailable: false,
    highInterestDebtAprPct: 3,
    highInterestDebtBalanceUsd: 0,
    hsaEligible: true,
    hsaRemainingUsd: 2_000,
    rothPath: 'direct',
    iraRemainingUsd: 7_500,
    employee401kRemainingUsd: 10_000,
    tbillYieldPct: 4.2,
    hysaYieldPct: 3.9,
    debtPayoffHurdleAprPct: 0.06,
    speculativeSleeveCapFraction: 0.05,
    yieldsFetchedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('rankNextDollar — waterfall order', () => {
  it('the canonical order is preserved: emergency → match → debt → HSA → Roth → 401k → taxable → paper LAST', () => {
    const plan = rankNextDollar(inputs())
    expect(plan.steps.map(s => s.id)).toEqual([
      'emergency_fund', 'employer_match', 'high_interest_debt', 'hsa',
      'roth_ira', 'trad_401k', 'taxable_or_cash', 'paper_bankroll',
    ])
    // paper bankroll is ALWAYS last and never 'recommended'.
    const paper = plan.steps[plan.steps.length - 1]
    expect(paper.id).toBe('paper_bankroll')
    expect(paper.status).toBe('not_applicable')
    expect(paper.reason).toContain('PAPER')
  })

  it('underfunded emergency fund is the best next dollar, before everything', () => {
    const plan = rankNextDollar(inputs({ emergencyFundUsd: 5_000, emergencyTargetUsd: 18_000 }))
    expect(plan.bestNext?.id).toBe('emergency_fund')
    expect(plan.bestNext?.reason).toContain('$13,000')
  })

  it('unclaimed employer match ranks ahead of debt and HSA', () => {
    const plan = rankNextDollar(inputs({ employerMatchAvailable: true }))
    expect(plan.bestNext?.id).toBe('employer_match')
  })

  it('debt above the hurdle beats HSA/Roth; below the hurdle it is satisfied', () => {
    const above = rankNextDollar(inputs({ highInterestDebtAprPct: 22, highInterestDebtBalanceUsd: 5_000 }))
    expect(above.bestNext?.id).toBe('high_interest_debt')
    expect(above.bestNext?.reason).toContain('risk-free')

    const below = rankNextDollar(inputs({ highInterestDebtAprPct: 4, highInterestDebtBalanceUsd: 5_000 }))
    expect(below.steps.find(s => s.id === 'high_interest_debt')?.status).toBe('satisfied')
  })

  it('backdoor Roth carries the pro-rata warning and CPA review flag', () => {
    const plan = rankNextDollar(inputs({ rothPath: 'backdoor' }))
    const roth = plan.steps.find(s => s.id === 'roth_ira')!
    expect(roth.status).toBe('recommended')
    expect(roth.reason).toContain('PRO-RATA')
    expect(roth.reason).toContain('CPA review')
    expect(roth.quality.requiresProfessionalReview).toBe(true)
  })

  it('missing inputs produce needs_data steps, never confident guesses', () => {
    const plan = rankNextDollar(inputs({
      emergencyFundUsd: null, emergencyTargetUsd: null,
      employerMatchAvailable: null,
      highInterestDebtAprPct: null,
      hsaEligible: null,
      rothPath: null, iraRemainingUsd: null,
      employee401kRemainingUsd: null,
    }))
    const needsData = plan.steps.filter(s => s.status === 'needs_data').map(s => s.id)
    expect(needsData).toEqual([
      'emergency_fund', 'employer_match', 'high_interest_debt', 'hsa', 'roth_ira', 'trad_401k',
    ])
    for (const s of plan.steps.filter(x => x.status === 'needs_data')) {
      expect(s.missingInputs.length).toBeGreaterThan(0)
      expect(s.quality.confidence).toBe('low')
    }
  })

  it('everything satisfied → taxable/cash reserve is the recommendation', () => {
    const plan = rankNextDollar(inputs({ hsaRemainingUsd: 0, iraRemainingUsd: 0, employee401kRemainingUsd: 0 }))
    expect(plan.bestNext?.id).toBe('taxable_or_cash')
    expect(plan.bestNext?.reason).toContain('T-bills/HYSA')
  })

  it('never uses loophole language; discloses it moves no money', () => {
    const plan = rankNextDollar(inputs())
    const text = JSON.stringify(plan).toLowerCase()
    expect(text).not.toContain('loophole')
    expect(plan.disclaimer).toContain('Nothing here moves money')
    expect(plan.disclaimer).toContain('Educational')
  })
})

describe('data-quality labels (item 10)', () => {
  it('completeness and confidence derive from present vs missing inputs', () => {
    const q = buildQualityLabel({
      presentInputs: ['a', 'b', 'c'], missingInputs: ['d'],
      requiresProfessionalReview: true,
    })
    expect(q.completenessPct).toBe(75)
    expect(q.confidence).toBe('medium')
    expect(q.requiresProfessionalReview).toBe(true)
    expect(q.informationalOnly).toBe(true)
  })

  it('stale rates cap confidence at medium and are flagged', () => {
    const q = buildQualityLabel({
      presentInputs: ['a'], missingInputs: [],
      usesRates: true,
      yieldsFetchedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      requiresProfessionalReview: false,
    })
    expect(q.ratesCurrent).toBe(false)
    expect(q.confidence).toBe('medium')
  })

  it('items that do not use rates report ratesCurrent: null (not a claim)', () => {
    const q = buildQualityLabel({
      presentInputs: ['a'], missingInputs: [], requiresProfessionalReview: false,
    })
    expect(q.ratesCurrent).toBeNull()
    expect(q.taxConstantsCurrent).toBeNull()
  })

  it('splitInputs maps null fields to human-readable missing names', () => {
    const { present, missing } = splitInputs(
      { cash: 1000, expenses: null },
      { cash: 'liquid cash', expenses: 'monthly expenses' }
    )
    expect(present).toEqual(['liquid cash'])
    expect(missing).toEqual(['monthly expenses'])
  })
})
